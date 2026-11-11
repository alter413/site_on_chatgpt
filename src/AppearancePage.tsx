import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react';
import { usePanel } from './context';
import { Button, Panel } from './ui';

import { Heading } from './Heading';

export function AppearancePage() {
  const { appearance, setAppearance, notify } = usePanel();
  return (
    <>
      <Heading
        eyebrow="СДЕЛАЙТЕ ПО-СВОЕМУ"
        title="Внешний вид"
        text="Ваше рабочее пространство должно быть удобным именно вам."
      />
      <div className="settings-columns">
        <Panel
          title="Тема оформления"
          subtitle="Изменения применяются сразу и сохраняются в этом браузере"
        >
          <div className="theme-options">
            {(
              [
                { value: 'light', label: 'Светлая', icon: Sun },
                { value: 'dark', label: 'Тёмная', icon: Moon },
                { value: 'system', label: 'Как в системе', icon: Monitor },
              ] as const
            ).map((t) => (
              <button
                key={t.value}
                className={`theme-choice ${appearance.theme === t.value ? 'selected' : ''}`}
                onClick={() => setAppearance({ ...appearance, theme: t.value })}
                aria-pressed={appearance.theme === t.value}
              >
                <div className={`theme-preview ${t.value}`}>
                  <i />
                  <span>
                    <b />
                    <b />
                    <b />
                  </span>
                </div>
                <span>
                  <t.icon size={15} />
                  {t.label}
                  {appearance.theme === t.value && <Check size={15} />}
                </span>
              </button>
            ))}
          </div>
          <div className="editor-section">
            <h3>Цвет акцента</h3>
            <div className="accent-options">
              {(
                [
                  { value: 'mint', label: 'Мята' },
                  { value: 'blue', label: 'Океан' },
                  { value: 'amber', label: 'Янтарь' },
                ] as const
              ).map((a) => (
                <button
                  key={a.value}
                  className={`accent-choice ${a.value}`}
                  onClick={() => setAppearance({ ...appearance, accent: a.value })}
                  aria-label={a.label}
                  aria-pressed={appearance.accent === a.value}
                >
                  {appearance.accent === a.value && <Check size={19} />}
                  <span>{a.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="editor-section">
            <h3>Плотность интерфейса</h3>
            <div className="segmented">
              <button
                aria-pressed={appearance.density === 'comfortable'}
                onClick={() => setAppearance({ ...appearance, density: 'comfortable' })}
              >
                Комфортная
              </button>
              <button
                aria-pressed={appearance.density === 'compact'}
                onClick={() => setAppearance({ ...appearance, density: 'compact' })}
              >
                Компактная
              </button>
            </div>
          </div>
          <label className="field">
            Название вашего пространства
            <input
              maxLength={40}
              value={appearance.title}
              onChange={(e) => setAppearance({ ...appearance, title: e.target.value })}
            />
          </label>
          <label className="field">
            Обновление данных
            <select
              value={appearance.refresh}
              onChange={(e) => setAppearance({ ...appearance, refresh: Number(e.target.value) })}
            >
              <option value={0}>Только вручную</option>
              <option value={15}>Каждые 15 секунд</option>
              <option value={30}>Каждые 30 секунд</option>
              <option value={60}>Каждую минуту</option>
            </select>
          </label>
          <Button
            variant="secondary"
            onClick={() => {
              setAppearance({
                theme: 'light',
                accent: 'mint',
                density: 'comfortable',
                title: 'Моё пространство',
                refresh: 30,
              });
              notify('Оформление сброшено');
            }}
          >
            Сбросить оформление
          </Button>
        </Panel>
        <div className="settings-side">
          <div className="appearance-card">
            <Palette size={29} />
            <h2>
              Меньше шума.
              <br />
              Больше вашего.
            </h2>
            <p>
              Тема, цвет и плотность работают во всех разделах. Параметры оформления не влияют на
              поведение бота.
            </p>
          </div>
          <Panel title="Доступность">
            <ul className="check-list">
              <li>
                <Check size={15} />
                Управление с клавиатуры
              </li>
              <li>
                <Check size={15} />
                Заметный фокус элементов
              </li>
              <li>
                <Check size={15} />
                Текстовые подписи статусов
              </li>
              <li>
                <Check size={15} />
                Поддержка reduced motion
              </li>
              <li>
                <Check size={15} />
                Адаптация к мобильному экрану
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
