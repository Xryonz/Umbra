import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SectionHeader } from './_shared'

/**
 * LanguageSection — seletor de idioma. EN e PT funcionam; o resto está
 * listado como "em breve" (honesto: não finge traduzir o que não traduzimos).
 * Trocar o idioma reflete na hora nas telas já migradas (ex: este nav).
 */
const LANGS: Array<{ code: string; native: string; sub: string; available: boolean }> = [
  { code: 'en', native: 'English',   sub: 'English',  available: true },
  { code: 'pt', native: 'Português', sub: 'Brasil',   available: true },
  { code: 'es', native: 'Español',   sub: 'Spanish',  available: false },
  { code: 'zh', native: '中文',       sub: 'Chinese',  available: false },
  { code: 'hi', native: 'हिन्दी',     sub: 'Hindi',    available: false },
  { code: 'fr', native: 'Français',  sub: 'French',   available: false },
  { code: 'ar', native: 'العربية',    sub: 'Arabic',   available: false },
  { code: 'ru', native: 'Русский',   sub: 'Russian',  available: false },
  { code: 'ja', native: '日本語',     sub: 'Japanese', available: false },
  { code: 'de', native: 'Deutsch',   sub: 'German',   available: false },
]

export default function LanguageSection() {
  const { t, i18n } = useTranslation()
  const current = i18n.resolvedLanguage ?? i18n.language ?? 'en'

  return (
    <div>
      <SectionHeader title={t('language.title')} description={t('language.description')} />

      <ul className="flex flex-col gap-1.5 mt-2">
        {LANGS.map((l) => {
          const active = current.startsWith(l.code)
          return (
            <li key={l.code}>
              <button
                disabled={!l.available}
                onClick={() => { if (l.available) void i18n.changeLanguage(l.code) }}
                className={cn(
                  'w-full flex items-center gap-3 px-4 py-3 border text-left transition-colors',
                  active
                    ? 'border-(--accent) bg-(--accent-dim)'
                    : l.available
                      ? 'border-(--border) hover:border-(--border-bright) hover:bg-(--raised)/40 cursor-pointer'
                      : 'border-(--border) opacity-45 cursor-not-allowed',
                )}
              >
                <span className="flex-1 min-w-0">
                  <span className="block text-sm" style={{ fontFamily: 'var(--font-display)' }}>{l.native}</span>
                  <span className="block text-xs text-(--text-3)">{l.sub}</span>
                </span>
                {active && <Check className="size-4 text-(--accent) shrink-0" />}
                {!l.available && (
                  <span className="text-[10px] uppercase tracking-wider text-(--text-3) font-mono shrink-0">
                    {t('language.comingSoon')}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
