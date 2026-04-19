import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { MainPage } from '@/views/pages/MainPage'
import { I18nProvider } from '@/i18n'
import { applyTheme, resolveInitialTheme } from '@/views/utils/theme'
import './index.css'

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Root element #root not found')

applyTheme(resolveInitialTheme())

createRoot(rootEl).render(
  <StrictMode>
    <I18nProvider>
      <BrowserRouter>
        <MainPage />
      </BrowserRouter>
    </I18nProvider>
  </StrictMode>,
)
