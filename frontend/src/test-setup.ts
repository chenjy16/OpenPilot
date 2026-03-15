import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './i18n/locales/en';
import zh from './i18n/locales/zh';

// Initialize i18n for tests with Chinese as default (tests expect Chinese text)
i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, zh: { translation: zh } },
  lng: 'zh',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});
