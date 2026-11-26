/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_USE_MSW?: string;
  /** With VITE_USE_MSW: pretend AI drafting is switched off (LLM_PROVIDER=none). */
  readonly VITE_MOCK_AI_OFF?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
