export const SETUP_COMPANY_NAME_MAX_LENGTH = 100;
export const SETUP_DEPARTMENT_NAME_MAX_LENGTH = 50;
export const SETUP_LEGAL_NAME_MAX_LENGTH = 30;
export const SETUP_EMAIL_MAX_LENGTH = 254;
export const SETUP_EXTENSION_MAX_LENGTH = 10;
export const SETUP_JOB_TITLE_MAX_LENGTH = 30;
export const SETUP_LOGIN_ID_MIN_LENGTH = 3;
export const SETUP_LOGIN_ID_MAX_LENGTH = 32;
export const BASE64URL_32_BYTE_LENGTH = 43;

export const SETUP_LOGIN_ID_PATTERN = new RegExp(
  `^[A-Za-z0-9._-]{${SETUP_LOGIN_ID_MIN_LENGTH},${SETUP_LOGIN_ID_MAX_LENGTH}}$`,
);

// 画面では空欄を許し、APIでは別の min(1) によって省略と空文字を区別する。
export const SETUP_EXTENSION_PATTERN = new RegExp(
  `^([0-9-]{1,${SETUP_EXTENSION_MAX_LENGTH}})?$`,
);

export const BASE64URL_32_BYTE_PATTERN = new RegExp(
  `^[A-Za-z0-9_-]{${BASE64URL_32_BYTE_LENGTH}}$`,
);
