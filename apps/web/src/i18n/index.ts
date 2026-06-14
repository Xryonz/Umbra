/**
 * i18n — esqueleto de internacionalização (react-i18next).
 *
 * Estado: PT e EN traduzidos parcialmente (configurações primeiro). O resto
 * do app ainda é PT hardcoded; vamos migrando tela por tela. Os outros idiomas
 * aparecem no seletor marcados "em breve".
 *
 * Detecção: localStorage (escolha do user) → navegador. Fallback = inglês
 * (padrão pedido). nonExplicit mapeia pt-BR/pt-PT → 'pt'.
 */
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './locales/en.json'
import pt from './locales/pt.json'

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      pt: { translation: pt },
    },
    fallbackLng: 'en',
    supportedLngs: ['en', 'pt'],
    nonExplicitSupportedLngs: true,
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'astra-lang',
      caches: ['localStorage'],
    },
    interpolation: { escapeValue: false },
  })

export default i18n
