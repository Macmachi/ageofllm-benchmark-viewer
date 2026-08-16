/*
 * model-meta.js — per-model presentation metadata: flag, author, "new" badge.
 *
 * Loaded before leaderboard.js and ladder.js. Kept in ONE place on purpose:
 * two pages holding two copies of this table is exactly how "GLM 5.1" ended up
 * rendered under two keys in v0.16.1. Add a single entry here when a new model
 * is benchmarked and both pages pick it up.
 */

window.MODEL_META = {
  // 🇨🇭 Switzerland — deterministic benchmark anchor (not an LLM)
  'champion-agent':                    { flag: '🇨🇭', author: 'Rymentz AI' },
  // 🇺🇸 United States
  'gpt-5.5':                           { flag: '🇺🇸', author: 'OpenAI' },
  'claude-fable-5':                    { flag: '🇺🇸', author: 'Anthropic', isNew: true },
  'claude-opus-4.8':                   { flag: '🇺🇸', author: 'Anthropic' },
  'gemini-3.5-flash':                  { flag: '🇺🇸', author: 'Google' },
  'gemini-3.1-pro':                    { flag: '🇺🇸', author: 'Google' },
  'grok-4.3':                          { flag: '🇺🇸', author: 'xAI' },
  'nvidia-nemotron-3-ultra-550b-a55b': { flag: '🇺🇸', author: 'Nvidia' },
  // 🇨🇳 China
  'deepseek-v4-pro-e':                 { flag: '🇨🇳', author: 'DeepSeek' },
  'mimo-v2.5-pro':                     { flag: '🇨🇳', author: 'Xiaomi' },
  'qwen3.7-max':                       { flag: '🇨🇳', author: 'Alibaba' },
  'minimax-m3':                        { flag: '🇨🇳', author: 'MiniMax', isNew: true },
  'kimi-k2.7-code':                    { flag: '🇨🇳', author: 'Moonshot', isNew: true },
  'kimi-k2.6':                         { flag: '🇨🇳', author: 'Moonshot' },
  'zai-org-glm-5-1':                   { flag: '🇨🇳', author: 'Zhipu' },
  'glm-5.1-fw':                        { flag: '🇨🇳', author: 'Zhipu' },
  'glm-5.2':                           { flag: '🇨🇳', author: 'Zhipu', isNew: true },

  // ── Ladder era (V2): models are keyed by their full provider slug, because
  //    that is the id the ladder runner records in data/ladder.json.
  'anthropic/claude-opus-5':           { flag: '🇺🇸', author: 'Anthropic', isNew: true },
  'openai/gpt-5.6-sol':                { flag: '🇺🇸', author: 'OpenAI', isNew: true },
  'x-ai/grok-4.6':                     { flag: '🇺🇸', author: 'xAI', isNew: true },
  'moonshotai/kimi-k3':                { flag: '🇨🇳', author: 'Moonshot', isNew: true },
  'qwen/qwen3.8-27b':                  { flag: '🇨🇳', author: 'Alibaba', isNew: true },
  'z-ai/glm-5.2':                      { flag: '🇨🇳', author: 'Zhipu' },
  'z-ai/glm-5.3':                      { flag: '🇨🇳', author: 'Zhipu', isNew: true },
};

/* Reasoning-effort badge, shared by the leaderboard and the ladder.
   Levels are OpenRouter's, strongest first: max / xhigh / high / medium / low /
   minimal, plus "off" (not asked to reason) and "NA" (asked, but the provider
   never returned any reasoning). */
window.EFFORT_LABEL = {
  max: 'MAX', xhigh: 'XHIGH', high: 'HIGH', medium: 'MED',
  low: 'LOW', minimal: 'MIN', off: 'OFF', na: 'NA',
};

window.effortBadge = function (effort) {
  const e = String(effort || 'off').toLowerCase();
  const label = window.EFFORT_LABEL[e] || e.toUpperCase();
  const safe = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<span class="effort effort-${safe(e)}" title="Reasoning effort">${safe(label)}</span>`;
};
