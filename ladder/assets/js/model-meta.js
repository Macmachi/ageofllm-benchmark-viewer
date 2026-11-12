/*! Age of LLM · Copyright (C) 2026 Rymentz · AGPL-3.0-or-later · https://ageofllm.org */
window.MODEL_META = {
  "champion-agent": { flag: "🇨🇭", author: "Rymentz AI" },
  "gpt-5.5": { flag: "🇺🇸", author: "OpenAI" },
  "claude-fable-5": { flag: "🇺🇸", author: "Anthropic", isNew: true },
  "claude-opus-4.8": { flag: "🇺🇸", author: "Anthropic" },
  "gemini-3.5-flash": { flag: "🇺🇸", author: "Google" },
  "gemini-3.1-pro": { flag: "🇺🇸", author: "Google" },
  "grok-4.3": { flag: "🇺🇸", author: "xAI" },
  "nvidia-nemotron-3-ultra-550b-a55b": { flag: "🇺🇸", author: "Nvidia" },
  "deepseek-v4-pro-e": { flag: "🇨🇳", author: "DeepSeek" },
  "mimo-v2.5-pro": { flag: "🇨🇳", author: "Xiaomi" },
  "qwen3.7-max": { flag: "🇨🇳", author: "Alibaba" },
  "minimax-m3": { flag: "🇨🇳", author: "MiniMax", isNew: true },
  "kimi-k2.7-code": { flag: "🇨🇳", author: "Moonshot", isNew: true },
  "kimi-k2.6": { flag: "🇨🇳", author: "Moonshot" },
  "zai-org-glm-5-1": { flag: "🇨🇳", author: "Zhipu" },
  "glm-5.1-fw": { flag: "🇨🇳", author: "Zhipu" },
  "glm-5.2": { flag: "🇨🇳", author: "Zhipu", isNew: true },
  "anthropic/claude-opus-5": { flag: "🇺🇸", author: "Anthropic", isNew: true },
  "openai/gpt-5.6-sol": { flag: "🇺🇸", author: "OpenAI", isNew: true },
  "x-ai/grok-4.6": { flag: "🇺🇸", author: "xAI", isNew: true },
  "moonshotai/kimi-k3": { flag: "🇨🇳", author: "Moonshot", isNew: true },
  "qwen/qwen3.8-27b": { flag: "🇨🇳", author: "Alibaba", isNew: true },
  "z-ai/glm-5.2": { flag: "🇨🇳", author: "Zhipu" },
  "z-ai/glm-5.3": { flag: "🇨🇳", author: "Zhipu", isNew: true },
  "google/gemini-3.7-flash": { flag: "🇺🇸", author: "Google", isNew: true }
};
window.EFFORT_LABEL = {
  max: "MAX",
  xhigh: "XHIGH",
  high: "HIGH",
  medium: "MED",
  low: "LOW",
  minimal: "MIN",
  off: "OFF",
  na: "NA"
};
window.effortBadge = function(effort) {
  const e = String(effort || "off").toLowerCase();
  const label = window.EFFORT_LABEL[e] || e.toUpperCase();
  const safe = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  return `<span class="effort effort-${safe(e)}" title="Reasoning effort">${safe(label)}</span>`;
};
