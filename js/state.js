import * as db from './db.js';
import * as ai from './ai.js';
import { esc } from './ui.js';
import { newSchedule } from './sm2.js';

export const defaults = { newLimit: 10, rate: 1, showZh: true, useAsr: true };
export const settings = { ...defaults };
export async function loadSettings() { Object.assign(settings, defaults, await db.meta.get('settings', {})); }
export async function saveSettings(p) { Object.assign(settings, p); await db.meta.set('settings', { ...settings }); }

export const session = { draft: null, install: null };
/** 在原生客户端（Capacitor 手机 App / Tauri 桌面）里运行：网页文件已在安装包内，不需要 Service Worker、不需要“装到主屏” */
export const isNativeApp = () => !!(globalThis.Capacitor?.isNativePlatform?.() || globalThis.__TAURI_INTERNALS__ || /\bElectron\//.test(globalThis.navigator?.userAgent || ''));

/** AI 按钮：未配置时文字固定为“未配置AI，无法生成”，点击不会发起任何请求。 */
export function aiBtn(id, label, cls = '') {
  return ai.isConfigured()
    ? `<button class="btn ai ${cls}" id="${id}" data-ai>✨ ${esc(label)}</button>`
    : `<button class="btn ai ai-off ${cls}" id="${id}" data-ai-off title="去「我的」配置AI">未配置AI，无法生成</button>`;
}

const SAMPLE = [
  ['Receptionist', 'Hello, welcome to the clinic. Do you have an appointment?', '您好，欢迎来到诊所。您有预约吗？'],
  ['Patient', 'Yes, I have an appointment at three o’clock.', '有的，我三点钟有预约。'],
  ['Receptionist', 'Could you please fill out this form and show me your insurance card?', '请您填一下这张表，并出示您的保险卡好吗？'],
  ['Patient', 'Sure. How long is the wait?', '好的。要等多久？'],
  ['Receptionist', 'The doctor will see you in about ten minutes. Please have a seat.', '医生大约十分钟后见您。请先坐一下。'],
];
export function sampleMaterial() {
  const now = Date.now();
  return { id: 'sample-clinic', title: '示例：诊所前台接待', tags: ['示例', '诊所'], source: 'sample', sample: true, created: now, updatedAt: now,
    sentences: SAMPLE.map(([speaker, en, zh], i) => ({ id: 's' + i, speaker, en, zh })) };
}
export async function seedIfFirstRun() {
  if (await db.meta.get('seeded', false)) return;
  await db.materials.save(sampleMaterial()); await db.meta.set('seeded', true);
}

export function makeCard({ type, term, zh, phonetic = '', sentence = null, material = null, sentenceId = null, source = 'manual', note = '' }) {
  return { id: db.newId(), type, term, zh, phonetic, sentence, materialId: material, sentenceId, source, note, sch: newSchedule(), created: Date.now() };
}
export const CARD_TYPE = { word: '生词', phrase: '短语', expr: '表达', sentence: '句子' };
