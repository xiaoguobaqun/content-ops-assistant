'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const defaults = {
  openai: { label: 'OpenAI', protocol: 'openai', baseURL: 'https://api.openai.com/v1' },
  claude: { label: 'Claude', protocol: 'anthropic', baseURL: 'https://api.anthropic.com/v1' },
  deepseek: { label: 'DeepSeek', protocol: 'openai', baseURL: 'https://api.deepseek.com/v1' },
};
function normalizeBaseURL(value) {
  const text=value.trim();
  if (!text) return '';
  if (text.length > 2048) throw new Error('AI 接口地址无效');
  let url; try { url=new URL(text); } catch { throw new Error('AI 接口地址无效'); }
  const loopback=['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (!(url.protocol==='https:' || (url.protocol==='http:' && loopback)) || url.username || url.password || url.search || url.hash) throw new Error('AI 接口地址无效');
  return url.toString().replace(/\/$/, '');
}
function createAiSettingsStore({filePath, safeStorage}) {
  function encryptionAvailable() {
    try { return Boolean(safeStorage?.isEncryptionAvailable?.()) && safeStorage?.getSelectedStorageBackend?.() !== 'basic_text'; } catch { return false; }
  }
  function read() {
    let data;
    try { data = fs.readFileSync(filePath, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return {}; throw new Error('无法读取 AI 配置'); }
    try {
      const parsed = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).some(id => !defaults[id])) throw new Error();
      for (const item of Object.values(parsed)) {
        if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.baseURL !== 'string' || typeof item.model !== 'string' || (item.encryptedKey !== undefined && (typeof item.encryptedKey !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(item.encryptedKey)))) throw new Error();
      }
      return parsed;
    } catch { throw new Error('AI 配置记录损坏'); }
  }
  function publicItem(id, data) {
    const item = data[id] || {};
    const baseURL = item.baseURL ?? defaults[id].baseURL, model = item.model ?? '', hasKey = Boolean(item.encryptedKey);
    return {id, label:defaults[id].label, protocol:defaults[id].protocol, baseURL, model, hasKey, configured:Boolean(baseURL && model && hasKey)};
  }
  function write(data) {
    fs.mkdirSync(path.dirname(filePath), {recursive:true, mode:0o700});
    const temp = `${filePath}.${crypto.randomBytes(12).toString('hex')}.tmp`;
    try { fs.writeFileSync(temp, JSON.stringify(data), {mode:0o600, flag:'wx'}); fs.renameSync(temp,filePath); } finally { try { fs.unlinkSync(temp); } catch (e) { if(e.code !== 'ENOENT') throw e; } }
  }
  return {
    list() { const data=read(); return Object.keys(defaults).map(id=>publicItem(id,data)); },
    save({id, baseURL, model, apiKey} = {}) {
      if (!Object.hasOwn(defaults,id)) throw new Error('未知 AI 服务');
      const data=read(), old=data[id] || {}, existing=publicItem(id,data);
      if (baseURL !== undefined && typeof baseURL !== 'string' || model !== undefined && typeof model !== 'string' || apiKey != null && typeof apiKey !== 'string') throw new Error('AI 配置格式无效');
      const nextBase=normalizeBaseURL(baseURL ?? existing.baseURL), nextModel=(model ?? existing.model).trim(), key=(apiKey ?? '').trim();
      if (nextModel.length > 256 || key.length > 8192) throw new Error('AI 配置过长');
      if (old.encryptedKey && !key && nextBase !== existing.baseURL) throw new Error('更换接口地址时请重新填写密钥');
      let encryptedKey=old.encryptedKey;
      if (key) {
        if (!encryptionAvailable()) throw new Error('系统加密不可用，无法保存密钥');
        try { encryptedKey=safeStorage.encryptString(key).toString('base64'); } catch { throw new Error('无法加密密钥'); }
      }
      data[id]={baseURL:nextBase,model:nextModel,...(encryptedKey?{encryptedKey}:{})};
      write(data); return publicItem(id,data);
    },
    resolve(id) {
      if (!Object.hasOwn(defaults,id)) throw new Error('未知 AI 服务');
      const data=read(), item=publicItem(id,data);
      if (!item.configured) throw new Error('请先完整配置 AI 服务');
      if (!encryptionAvailable()) throw new Error('系统加密不可用');
      let apiKey; try { apiKey=safeStorage.decryptString(Buffer.from(data[id].encryptedKey,'base64')); } catch { throw new Error('无法解密密钥'); }
      if (!apiKey) throw new Error('无法解密密钥');
      const {hasKey,configured,...provider}=item; return {...provider,apiKey};
    },
  };
}
module.exports={createAiSettingsStore};
