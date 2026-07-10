const RAW = "https://raw.githubusercontent.com/EJR-of-Scrutopia/popup-zapper/master/dist/popup-zapper.user.js";

export function buildHeader(version) {
  return `// ==UserScript==
// @name         Popup Zapper
// @namespace    https://github.com/EJR-of-Scrutopia/popup-zapper
// @version      ${version}
// @description  Remove login/consent/newsletter/paywall popups, reveal blurred/gated content, defeat reload traps, and learn popups by click.
// @author       Param
// @homepageURL  https://github.com/EJR-of-Scrutopia/popup-zapper
// @supportURL   https://github.com/EJR-of-Scrutopia/popup-zapper/issues
// @updateURL    ${RAW}
// @downloadURL  ${RAW}
// @match        *://*/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @grant        GM_info
// @grant        GM.setValue
// @grant        GM.getValue
// @grant        GM.setClipboard
// @grant        GM.xmlHttpRequest
// @grant        GM.openInTab
// @grant        GM.addStyle
// @connect      *
// @noframes
// ==/UserScript==
`;
}