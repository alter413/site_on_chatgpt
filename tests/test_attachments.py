from io import BytesIO

import pytest
from docx import Document
from PIL import Image
from pypdf import PdfWriter
from pypdf.generic import DecodedStreamObject, DictionaryObject, NameObject

from sandbox_bot.attachments import MAX_FILE, extract


def test_text_and_docx_and_pdf():
    assert extract("note.txt", "Привет".encode())["text"] == "Привет"
    document = Document()
    document.add_paragraph("document words")
    stream = BytesIO()
    document.save(stream)
    assert "document words" in extract("doc.docx", stream.getvalue())["text"]
    pdf = PdfWriter()
    pdf.add_blank_page(100, 100)
    stream = BytesIO()
    pdf.write(stream)
    with pytest.raises(ValueError, match="текст"):
        extract("blank.pdf", stream.getvalue())


def test_pdf_with_actual_text_layer():
    writer = PdfWriter()
    page = writer.add_blank_page(300, 300)
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type1"),
            NameObject("/BaseFont"): NameObject("/Helvetica"),
        }
    )
    page[NameObject("/Resources")] = DictionaryObject(
        {NameObject("/Font"): DictionaryObject({NameObject("/F1"): font})}
    )
    content = DecodedStreamObject()
    content.set_data(b"BT /F1 12 Tf 10 100 Td (Allowed owner facts) Tj ET")
    page[NameObject("/Contents")] = content
    stream = BytesIO()
    writer.write(stream)
    assert "Allowed owner facts" in extract("facts.pdf", stream.getvalue())["text"]


def test_images_are_verified_and_reencoded():
    stream = BytesIO()
    Image.new("RGB", (200, 100), "red").save(stream, format="PNG")
    result = extract("../photo.png", stream.getvalue())
    assert result["image"].startswith("data:image/jpeg;base64,")
    with pytest.raises(ValueError):
        extract("fake.png", b"not an image")


def test_unsupported_oversized_and_binary_text_fail():
    for name, data in [
        ("bad.exe", b"MZ"),
        ("huge.txt", b"x" * (MAX_FILE + 1)),
        ("binary.txt", b"hello\x00binary"),
    ]:
        with pytest.raises(ValueError):
            extract(name, data)
