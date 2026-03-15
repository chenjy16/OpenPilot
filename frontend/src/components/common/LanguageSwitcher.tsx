import { useTranslation } from 'react-i18next';

const LanguageSwitcher: React.FC = () => {
  const { t, i18n } = useTranslation();

  const toggle = () => {
    const next = i18n.language === 'zh' ? 'en' : 'zh';
    i18n.changeLanguage(next);
    localStorage.setItem('openpilot-lang', next);
  };

  return (
    <button
      onClick={toggle}
      className="rounded p-1 text-sm hover:bg-gray-800"
      title={i18n.language === 'zh' ? t('lang.switchToEn') : t('lang.switchToZh')}
    >
      {i18n.language === 'zh' ? t('lang.buttonEn') : t('lang.buttonZh')}
    </button>
  );
};

export default LanguageSwitcher;
