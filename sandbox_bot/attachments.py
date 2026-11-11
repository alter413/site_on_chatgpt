import base64
import warnings
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

from docx import Document
from PIL import Image, ImageOps
from pypdf import PdfReader

MAX_FILE = 8 * 1024 * 1024
MAX_TEXT = 100_000
TEXT_EXT = {".txt", ".md", ".json", ".csv", ".log", ".yaml", ".yml"}
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".webp", ".gif"}


def extract(filename: str, data: bytes) -> dict:
    if len(data) > MAX_FILE:
        raise ValueError("Файл больше 8 МБ")
    ext = Path(filename).suffix.lower()
    try:
        if ext in IMAGE_EXT:
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                with Image.open(BytesIO(data)) as original:
                    if original.width * original.height > 20_000_000:
                        raise ValueError("Изображение больше 20 мегапикселей")
                    image = ImageOps.exif_transpose(original).convert("RGB")
                    image.thumbnail((1024, 1024))
                    out = BytesIO()
                    image.save(out, format="JPEG", quality=65)
                    encoded = base64.b64encode(out.getvalue()).decode("ascii")
                    return {"image": f"data:image/jpeg;base64,{encoded}"}
        if ext in TEXT_EXT:
            text = data.decode("utf-8-sig")
            if "\x00" in text:
                raise ValueError("Бинарный файл вместо текста")
        elif ext == ".pdf":
            reader = PdfReader(BytesIO(data))
            if reader.is_encrypted:
                raise ValueError("Зашифрованный PDF не поддерживается")
            if len(reader.pages) > 100:
                raise ValueError("PDF больше 100 страниц")
            parts = []
            size = 0
            for page in reader.pages:
                part = page.extract_text() or ""
                size += len(part)
                if size > MAX_TEXT:
                    raise ValueError("Текст больше 100000 символов")
                parts.append(part)
            text = "\n".join(parts)
        elif ext == ".docx":
            with ZipFile(BytesIO(data)) as archive:
                if sum(i.file_size for i in archive.infolist()) > 32 * 1024 * 1024:
                    raise ValueError("Распакованный DOCX слишком большой")
            doc = Document(BytesIO(data))
            text = "\n".join(
                [p.text for p in doc.paragraphs]
                + [" | ".join(c.text for c in r.cells) for t in doc.tables for r in t.rows]
            )
        else:
            raise ValueError("Формат не поддерживается: нужен текст, PDF, DOCX или изображение")
        if len(text) > MAX_TEXT:
            raise ValueError("Текст больше 100000 символов; разделите файл")
        if not text.strip():
            raise ValueError("В файле нет текста. Для скана нужен OCR, он не подключён")
        return {"text": text}
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError(
            "Не удалось прочитать файл: повреждение или неподдерживаемая кодировка"
        ) from exc
