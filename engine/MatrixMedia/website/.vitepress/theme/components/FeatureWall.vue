<script setup>
import { ref, computed, onMounted } from 'vue'

import { loadGistEvents, saveGistFile, GIST_ID, REQ_FILE } from '../utils/gistStats'

const REPO = 'hanliang97/MatrixMedia'

const TYPES = [
  { value: 'feature', label: '功能需求' },
  { value: 'ux', label: '体验优化' },
  { value: 'platform', label: '平台支持' },
  { value: 'bug', label: 'Bug 反馈' },
  { value: 'other', label: '其他' },
]
const STATUSES = {
  open: { label: '待评估', cls: 'st-open' },
  planned: { label: '已排期', cls: 'st-planned' },
  done: { label: '已完成', cls: 'st-done' },
  rejected: { label: '已拒绝', cls: 'st-rejected' },
}
const PLATFORMS = ['抖音', '快手', '小红书', '视频号', 'B站', '百家号', '头条', '番茄视频', '通用']

// ---------- 列表状态 ----------
const loading = ref(false)
const error = ref('')
const items = ref([])
const updatedAt = ref(null)
const configOk = computed(() => !!GIST_ID)

const filterType = ref('all')
const filterStatus = ref('all')
const keyword = ref('')

const filtered = computed(() => {
  let list = [...items.value]
  if (filterType.value !== 'all') list = list.filter((i) => i.type === filterType.value)
  if (filterStatus.value !== 'all') list = list.filter((i) => i.status === filterStatus.value)
  const kw = keyword.value.trim().toLowerCase()
  if (kw) {
    list = list.filter(
      (i) =>
        String(i.title || '').toLowerCase().includes(kw) ||
        String(i.description || '').toLowerCase().includes(kw)
    )
  }
  return list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
})

const counts = computed(() => {
  const by = {}
  for (const s of Object.keys(STATUSES)) by[s] = items.value.filter((i) => (i.status || 'open') === s).length
  return by
})

// ---------- 详情 ----------
const detail = ref(null)

function openDetail(item) {
  detail.value = item
}

// ---------- 表单 ----------
const showForm = ref(false)
const submitting = ref(false)
const submitMode = ref('issue') // issue | gist
const formError = ref('')
const formOk = ref('')

const form = ref({
  title: '',
  type: 'feature',
  platforms: [],
  description: '',
  nickname: '',
  contact: '',
})
const token = ref('')

onMounted(() => {
  try {
    token.value = sessionStorage.getItem('mm_req_token') || ''
  } catch (_) {}
})

function typeLabel(v) {
  const t = TYPES.find((t) => t.value === v)
  return t ? t.label : v || '其他'
}

function statusInfo(v) {
  return STATUSES[v] || STATUSES.open
}

function fmtDate(s) {
  if (!s) return '-'
  const d = new Date(s)
  if (isNaN(d.getTime())) return s
  return d.toLocaleString('zh-CN', { hour12: false })
}

function excerpt(s, n = 120) {
  s = String(s || '')
  return s.length > n ? s.slice(0, n) + '…' : s
}

function maskContact(c) {
  c = String(c || '')
  if (!c) return ''
  if (c.length <= 4) return c[0] + '***'
  return c.slice(0, 2) + '***' + c.slice(-2)
}

// ---------- 读取 ----------
async function fetchList(force = false) {
  if (!configOk.value) {
    error.value = '未配置 GIST_ID（维护者请在 gistStats.js 中填入）'
    return
  }
  loading.value = true
  error.value = ''
  try {
    const res = await loadGistEvents(REQ_FILE, { force })
    if (res.error && !res.events.length) {
      error.value = `数据加载失败：${res.error}`
    } else {
      items.value = res.events
      updatedAt.value = res.updatedAt
      error.value = res.stale ? '当前展示的是本地缓存数据（远端暂时不可用）' : ''
    }
  } finally {
    loading.value = false
  }
}

function refresh() {
  return fetchList(true)
}

// ---------- 提交 ----------
function buildEntry() {
  return {
    id: 'req-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: form.value.title.trim(),
    type: form.value.type,
    platforms: form.value.platforms.slice(),
    description: form.value.description.trim(),
    nickname: form.value.nickname.trim(),
    contact: form.value.contact.trim(),
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function validate() {
  if (!form.value.title.trim()) return '请填写需求标题'
  if (form.value.title.trim().length > 80) return '标题最长 80 字'
  if (!form.value.description.trim()) return '请填写详细描述'
  if (form.value.description.trim().length > 2000) return '详细描述最长 2000 字'
  if (submitMode.value === 'gist' && !token.value.trim()) return '请填写 GitHub Token（需 gist 权限）'
  return ''
}

function entryToMarkdown(e) {
  const lines = [
    `**类型：** ${typeLabel(e.type)}`,
    `**涉及平台：** ${e.platforms.length ? e.platforms.join('、') : '通用'}`,
    `**昵称：** ${e.nickname || '匿名'}`,
    e.contact ? `**联系方式：** ${e.contact}` : '',
    '',
    '### 描述',
    '',
    e.description,
    '',
    '<details><summary>结构化数据（维护者同步到需求墙 Gist 用）</summary>',
    '',
    '```json',
    JSON.stringify(e, null, 2),
    '```',
    '',
    '</details>',
  ]
  return lines.filter((l) => l !== '').join('\n')
}

function openIssue(e) {
  const url =
    `https://github.com/${REPO}/issues/new` +
    `?title=${encodeURIComponent('[需求墙] ' + e.title)}` +
    `&body=${encodeURIComponent(entryToMarkdown(e))}`
  window.open(url, '_blank', 'noopener')
}

async function submit() {
  formError.value = ''
  formOk.value = ''
  const err = validate()
  if (err) {
    formError.value = err
    return
  }
  const entry = buildEntry()

  // 方式一：打开预填的 GitHub Issue，由维护者确认后同步到 Gist
  if (submitMode.value === 'issue') {
    openIssue(entry)
    formOk.value = '已打开 GitHub Issue 页面，登录后点击 Submit 即可完成提交（维护者会同步到需求墙）。'
    showForm.value = false
    return
  }

  // 方式二：直接写入 Gist（需要 gist 所有者的 token）
  submitting.value = true
  try {
    try {
      sessionStorage.setItem('mm_req_token', token.value.trim())
    } catch (_) {}
    const res = await loadGistEvents(REQ_FILE, { force: true })
    let list = Array.isArray(res.events) ? res.events.filter((e) => e.id !== entry.id) : []
    list.push(entry)
    await saveGistFile(REQ_FILE, list, token.value)
    formOk.value = '提交成功！需求已写入需求墙。'
    showForm.value = false
    resetForm()
    await fetchList(true)
  } catch (e) {
    formError.value = `写入失败：${(e && e.message) || e}`
  } finally {
    submitting.value = false
  }
}

function resetForm() {
  form.value = { title: '', type: 'feature', platforms: [], description: '', nickname: '', contact: '' }
}

onMounted(() => { fetchList() })
</script>

<template>
  <div class="fw">
    <div v-if="!configOk" class="fw-empty">
      ⚠️ 维护者尚未配置 GIST_ID。请在
      <code>website/.vitepress/theme/utils/gistStats.js</code> 中填入公开 Gist id。
    </div>

    <template v-else>
      <!-- 工具栏：左上角“我要提需求” + 刷新 -->
      <div class="fw-toolbar">
        <button class="fw-btn fw-btn-primary" @click="showForm = !showForm">
          {{ showForm ? '收起表单' : '＋ 我要提需求' }}
        </button>
        <button class="fw-btn" @click="refresh" :disabled="loading">
          {{ loading ? '加载中…' : '刷新' }}
        </button>
        <span v-if="updatedAt" class="fw-updated">更新于 {{ fmtDate(updatedAt) }}（5 分钟缓存）</span>
        <span v-if="error" class="fw-error">{{ error }}</span>
      </div>

      <div v-if="formOk" class="fw-ok">✅ {{ formOk }}</div>

      <!-- 提交表单 -->
      <div v-if="showForm" class="fw-form">
        <div class="fw-form-title">提交需求</div>

        <div class="fw-field">
          <label class="fw-label">需求标题 <span class="fw-req">*</span></label>
          <input v-model="form.title" class="fw-input" maxlength="80" placeholder="一句话概括你的需求（80 字以内）" />
        </div>

        <div class="fw-row">
          <div class="fw-field">
            <label class="fw-label">类型</label>
            <select v-model="form.type" class="fw-input">
              <option v-for="t in TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </div>
          <div class="fw-field">
            <label class="fw-label">昵称（选填）</label>
            <input v-model="form.nickname" class="fw-input" maxlength="30" placeholder="怎么称呼你" />
          </div>
        </div>

        <div class="fw-field">
          <label class="fw-label">涉及平台（可多选）</label>
          <div class="fw-checks">
            <label v-for="p in PLATFORMS" :key="p" class="fw-check">
              <input type="checkbox" :value="p" v-model="form.platforms" /> {{ p }}
            </label>
          </div>
        </div>

        <div class="fw-field">
          <label class="fw-label">详细描述 <span class="fw-req">*</span></label>
          <textarea v-model="form.description" class="fw-input fw-textarea" maxlength="2000"
            placeholder="描述你希望支持的功能 / 遇到的问题 / 期望的使用场景（2000 字以内）"></textarea>
        </div>

        <div class="fw-field">
          <label class="fw-label">联系方式（选填，仅维护者可见用途，会公开展示）</label>
          <input v-model="form.contact" class="fw-input" maxlength="60" placeholder="邮箱 / 微信 / GitHub 用户名等" />
        </div>

        <div class="fw-field">
          <label class="fw-label">提交方式</label>
          <div class="fw-modes">
            <label class="fw-mode">
              <input type="radio" value="issue" v-model="submitMode" />
              <span><strong>GitHub Issue（推荐）</strong><br />一键打开预填好的 Issue，登录 GitHub 点击提交即可，无需 Token。维护者确认后会同步到需求墙。</span>
            </label>
            <label class="fw-mode">
              <input type="radio" value="gist" v-model="submitMode" />
              <span><strong>直接写入 Gist（维护者）</strong><br />需要 Gist 所有者的 GitHub Token（需 gist 权限），提交后立即显示在需求墙。</span>
            </label>
          </div>
        </div>

        <div v-if="submitMode === 'gist'" class="fw-field">
          <label class="fw-label">GitHub Token（gist 权限）</label>
          <input v-model="token" type="password" class="fw-input" placeholder="ghp_…（仅保存在当前浏览器会话，用于本次提交）" />
          <div class="fw-hint">Token 只保存在你浏览器的 sessionStorage，不会上传到任何服务器（仅直接请求 GitHub API）。</div>
        </div>

        <div v-if="formError" class="fw-error fw-form-error">{{ formError }}</div>

        <div class="fw-form-actions">
          <button class="fw-btn fw-btn-primary" @click="submit" :disabled="submitting">
            {{ submitting ? '提交中…' : submitMode === 'issue' ? '打开 GitHub Issue 提交' : '提交到需求墙' }}
          </button>
          <button class="fw-btn" @click="showForm = false; formError = ''">取消</button>
        </div>
      </div>

      <!-- 筛选 -->
      <div class="fw-filters">
        <select v-model="filterType" class="fw-input fw-filter">
          <option value="all">全部类型（{{ items.length }}）</option>
          <option v-for="t in TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
        </select>
        <select v-model="filterStatus" class="fw-input fw-filter">
          <option value="all">全部状态</option>
          <option value="open">待评估（{{ counts.open }}）</option>
          <option value="planned">已排期（{{ counts.planned }}）</option>
          <option value="done">已完成（{{ counts.done }}）</option>
          <option value="rejected">已拒绝（{{ counts.rejected }}）</option>
        </select>
        <input v-model="keyword" class="fw-input fw-filter" placeholder="搜索标题 / 描述…" />
      </div>

      <!-- 需求列表 -->
      <div v-if="loading && !items.length" class="fw-loading">加载中…</div>
      <div v-else-if="!filtered.length" class="fw-empty">
        {{ items.length ? '没有符合筛选条件的需求。' : '还没有需求，点击左上角「我要提需求」提交第一条吧！' }}
      </div>
      <div v-else class="fw-list">
        <div v-for="item in filtered" :key="item.id" class="fw-item" @click="openDetail(item)">
          <div class="fw-item-head">
            <span class="fw-badge" :data-type="item.type">{{ typeLabel(item.type) }}</span>
            <span class="fw-status" :class="statusInfo(item.status).cls">{{ statusInfo(item.status).label }}</span>
            <span class="fw-item-date">{{ fmtDate(item.createdAt) }}</span>
          </div>
          <div class="fw-item-title">{{ item.title }}</div>
          <div class="fw-item-desc">{{ excerpt(item.description) }}</div>
          <div class="fw-item-foot">
            <span v-if="item.platforms && item.platforms.length" class="fw-item-platforms">
              {{ item.platforms.join(' · ') }}
            </span>
            <span class="fw-item-author">{{ item.nickname || '匿名' }}</span>
          </div>
        </div>
      </div>

      <!-- 详情弹层 -->
      <div v-if="detail" class="fw-modal" @click.self="detail = null">
        <div class="fw-modal-box">
          <button class="fw-modal-close" @click="detail = null">✕</button>
          <div class="fw-item-head">
            <span class="fw-badge" :data-type="detail.type">{{ typeLabel(detail.type) }}</span>
            <span class="fw-status" :class="statusInfo(detail.status).cls">{{ statusInfo(detail.status).label }}</span>
            <span class="fw-item-date">{{ fmtDate(detail.createdAt) }}</span>
          </div>
          <h3 class="fw-modal-title">{{ detail.title }}</h3>
          <div class="fw-meta">
            <div><span class="fw-meta-k">提交人</span>{{ detail.nickname || '匿名' }}</div>
            <div v-if="detail.contact"><span class="fw-meta-k">联系方式</span>{{ maskContact(detail.contact) }}</div>
            <div><span class="fw-meta-k">涉及平台</span>{{ (detail.platforms && detail.platforms.length) ? detail.platforms.join('、') : '通用' }}</div>
            <div v-if="detail.updatedAt && detail.updatedAt !== detail.createdAt">
              <span class="fw-meta-k">更新时间</span>{{ fmtDate(detail.updatedAt) }}
            </div>
            <div v-if="detail.issueUrl">
              <span class="fw-meta-k">相关 Issue</span>
              <a :href="detail.issueUrl" target="_blank" rel="noopener" @click.stop>#{{ detail.issueNumber || '查看' }}</a>
            </div>
          </div>
          <div class="fw-modal-desc">{{ detail.description }}</div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.fw { margin: 1.5rem 0; }

/* 工具栏 */
.fw-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
.fw-btn {
  border: 1px solid var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 14px;
}
.fw-btn:disabled { opacity: 0.6; cursor: default; }
.fw-btn-primary { background: var(--vp-c-brand-1); color: var(--vp-c-bg); font-weight: 600; }
.fw-updated { font-size: 13px; color: var(--vp-c-text-2); }
.fw-error { font-size: 13px; color: var(--vp-c-danger-1, #dc2626); }
.fw-ok {
  font-size: 14px; color: var(--vp-c-brand-1); border: 1px solid var(--vp-c-brand-1);
  border-radius: 8px; background: var(--vp-c-brand-soft); padding: 10px 14px; margin-bottom: 16px;
}

/* 表单 */
.fw-form {
  border: 1px solid var(--vp-c-divider); border-radius: 10px; padding: 20px;
  background: var(--vp-c-bg); margin-bottom: 24px;
}
.fw-form-title { font-weight: 700; font-size: 16px; margin-bottom: 16px; color: var(--vp-c-text-1); }
.fw-field { margin-bottom: 14px; }
.fw-label { display: block; font-size: 13px; color: var(--vp-c-text-2); margin-bottom: 6px; font-weight: 600; }
.fw-req { color: var(--vp-c-danger-1, #dc2626); }
.fw-input {
  width: 100%; box-sizing: border-box; border: 1px solid var(--vp-c-divider); border-radius: 6px;
  padding: 8px 10px; font-size: 14px; background: var(--vp-c-bg); color: var(--vp-c-text-1);
}
.fw-input:focus { outline: none; border-color: var(--vp-c-brand-1); }
.fw-textarea { min-height: 120px; resize: vertical; font-family: inherit; }
.fw-row { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.fw-checks { display: flex; flex-wrap: wrap; gap: 8px 18px; }
.fw-check { font-size: 14px; color: var(--vp-c-text-1); display: inline-flex; align-items: center; gap: 5px; cursor: pointer; }
.fw-modes { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.fw-mode {
  border: 1px solid var(--vp-c-divider); border-radius: 8px; padding: 10px 12px;
  font-size: 13px; line-height: 1.6; cursor: pointer; color: var(--vp-c-text-2);
  display: flex; gap: 8px; align-items: flex-start;
}
.fw-mode:has(input:checked) { border-color: var(--vp-c-brand-1); background: var(--vp-c-brand-soft); }
.fw-hint { font-size: 12px; color: var(--vp-c-text-3); margin-top: 6px; line-height: 1.6; }
.fw-form-error { margin: 6px 0; }
.fw-form-actions { display: flex; gap: 12px; margin-top: 8px; }

/* 筛选 */
.fw-filters { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
.fw-filter { width: auto; min-width: 150px; flex: 0 1 220px; }

/* 列表 */
.fw-loading, .fw-empty {
  padding: 14px 16px; border: 1px dashed var(--vp-c-divider); border-radius: 8px;
  color: var(--vp-c-text-2); font-size: 14px; line-height: 1.7;
}
.fw-list { display: flex; flex-direction: column; gap: 12px; }
.fw-item {
  border: 1px solid var(--vp-c-divider); border-radius: 10px; padding: 14px 16px;
  background: var(--vp-c-bg); cursor: pointer; transition: border-color 0.15s;
}
.fw-item:hover { border-color: var(--vp-c-brand-1); }
.fw-item-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 8px; }
.fw-item-date { font-size: 12px; color: var(--vp-c-text-3); margin-left: auto; }
.fw-badge {
  font-size: 12px; padding: 2px 8px; border-radius: 10px;
  background: var(--vp-c-brand-soft); color: var(--vp-c-brand-1); font-weight: 600;
}
.fw-badge[data-type="bug"] { background: rgba(220, 38, 38, 0.12); color: #dc2626; }
.fw-badge[data-type="platform"] { background: rgba(37, 99, 235, 0.12); color: #2563eb; }
.fw-badge[data-type="ux"] { background: rgba(217, 119, 6, 0.12); color: #d97706; }
.fw-status { font-size: 12px; padding: 2px 8px; border-radius: 10px; font-weight: 600; }
.st-open { background: rgba(107, 114, 128, 0.14); color: #6b7280; }
.st-planned { background: rgba(37, 99, 235, 0.12); color: #2563eb; }
.st-done { background: rgba(22, 163, 74, 0.12); color: #16a34a; }
.st-rejected { background: rgba(220, 38, 38, 0.12); color: #dc2626; }
.fw-item-title { font-weight: 600; font-size: 15px; color: var(--vp-c-text-1); margin-bottom: 6px; }
.fw-item-desc { font-size: 13px; color: var(--vp-c-text-2); line-height: 1.7; }
.fw-item-foot { display: flex; gap: 12px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
.fw-item-platforms { font-size: 12px; color: var(--vp-c-text-3); }
.fw-item-author { font-size: 12px; color: var(--vp-c-text-3); margin-left: auto; }

/* 详情弹层 */
.fw-modal {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 100;
  display: flex; align-items: center; justify-content: center; padding: 20px;
}
.fw-modal-box {
  position: relative; background: var(--vp-c-bg); border-radius: 12px; padding: 24px;
  max-width: 640px; width: 100%; max-height: 80vh; overflow-y: auto;
  border: 1px solid var(--vp-c-divider);
}
.fw-modal-close {
  position: absolute; top: 12px; right: 12px; border: none; background: none;
  font-size: 16px; cursor: pointer; color: var(--vp-c-text-2);
}
.fw-modal-title { font-size: 18px; margin: 8px 0 14px; color: var(--vp-c-text-1); }
.fw-meta { display: flex; flex-direction: column; gap: 6px; font-size: 13px; color: var(--vp-c-text-2); margin-bottom: 16px; }
.fw-meta-k { display: inline-block; min-width: 70px; color: var(--vp-c-text-3); }
.fw-modal-desc { font-size: 14px; line-height: 1.8; color: var(--vp-c-text-1); white-space: pre-wrap; word-break: break-word; }

@media (max-width: 640px) {
  .fw-row, .fw-modes { grid-template-columns: 1fr; }
}
</style>
