/* 版本管理（Semantic Versioning）
 *
 *   MAJOR —— 只有用户明确指示时才提升
 *   MINOR —— 新增基础功能时提升
 *   PATCH —— 修 bug 时提升
 *
 * 每次改动都要提升 PATCH（或 MINOR），并在界面右下角显示，
 * 这样用户能确认自己看到的是不是最新版本。
 */

export const VERSION = {
  major: 0,
  minor: 11,
  patch: 0,
  /** 本次构建时间，用于进一步确认不是缓存 */
  built: '2026-10-05',
};

export const VERSION_STRING =
  `${VERSION.major}.${VERSION.minor}.${String(VERSION.patch).padStart(3, '0')}`;

export const VERSION_FULL = `v${VERSION_STRING} · ${VERSION.built}`;
