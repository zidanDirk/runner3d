import { useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { FeedbackSubmission, manualFeedbackAdapter } from '../beta-feedback/adapter';
import type { FeedbackAdapter } from '../beta-feedback/adapter';
import { FEEDBACK_CATEGORIES, FEEDBACK_MAX_LENGTH, FEEDBACK_MIN_LENGTH, sanitizeFeedbackDiagnostics } from '../beta-feedback/schema';
import type { FeedbackDiagnostics } from '../beta-feedback/schema';
import './beta-feedback.css';

export function BetaFeedback({ diagnostics, adapter = manualFeedbackAdapter }: { diagnostics: FeedbackDiagnostics; adapter?: FeedbackAdapter }) {
  const [category, setCategory] = useState('controls');
  const [message, setMessage] = useState('');
  const [includeDiagnostics, setIncludeDiagnostics] = useState(false);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [prepared, setPrepared] = useState('');
  const output = useRef<HTMLTextAreaElement>(null);
  const pending = useRef(false);
  const submission = useMemo(() => new FeedbackSubmission(adapter), [adapter]);
  const safeDiagnostics = useMemo(() => sanitizeFeedbackDiagnostics(diagnostics), [diagnostics]);
  const clearPrepared = () => { setPrepared(''); setNotice(''); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current) return;
    pending.current = true; setSending(true); setNotice('');
    const result = await submission.submit(category, message, includeDiagnostics ? safeDiagnostics : undefined, safeDiagnostics.release);
    if (result.status === 'manual') { setPrepared(result.text); setNotice('反馈文本已在本页生成，尚未发送。复制或下载后，请交给邀请你试玩的人。'); }
    else if (result.status === 'accepted') setNotice('接收服务已确认收到反馈。');
    else if (result.status === 'duplicate') { if (result.text) setPrepared(result.text); setNotice(adapter.mode === 'manual' ? '相同内容已生成，请使用下方文本。修改内容后可以重新生成。' : '这份反馈已被接收，无需重复发送。'); }
    else if (result.status !== 'busy') setNotice(result.error);
    pending.current = false; setSending(false);
  };
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(prepared);
      setNotice('已复制。反馈仍未发送，请交给邀请你试玩的人。');
    } catch {
      output.current?.focus(); output.current?.select();
      setNotice('无法自动复制，已选中文本。请使用系统复制功能，再交给邀请你试玩的人。');
    }
  };
  const download = () => {
    let createdUrl: string | undefined;
    try {
      const url = URL.createObjectURL(new Blob([prepared], { type: 'text/plain;charset=utf-8' }));
      createdUrl = url;
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = 'runner3d-beta-feedback.txt'; anchor.click();
      setNotice('已准备下载本地文本，尚未发送。请把文件交给邀请你试玩的人。');
    } catch {
      output.current?.focus(); output.current?.select();
      setNotice('当前浏览器未能下载文件，已选中文本。请复制后交给邀请你试玩的人。');
    } finally {
      const url = createdUrl;
      if (url) setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  };
  return <div className="beta-feedback">
    <p className="panel-hint">感谢你帮忙试玩。请勿填写姓名、电话、邮箱、账号或其他私人信息。</p>
    <p className="beta-feedback__release">此反馈会包含版本 {safeDiagnostics.release.version} · Build {safeDiagnostics.release.buildId} · {safeDiagnostics.release.environment}，便于定位本次构建。</p>
    <p className="beta-feedback__destination">{adapter.mode === 'manual' ? '目前没有在线反馈服务。内容只留在本页，由你复制或下载后，手动交给试玩组织者。关闭页面会丢弃未保存的内容。' : '你点击发送后，反馈才交给已配置的接收服务。请先确认试玩组织者提供的数据说明。'}</p>
    <form onSubmit={event => { void submit(event); }}>
      <label htmlFor="beta-feedback-category">反馈类型</label>
      <select id="beta-feedback-category" value={category} disabled={sending} onChange={event => { setCategory(event.target.value); clearPrepared(); }}>{FEEDBACK_CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
      <label htmlFor="beta-feedback-message">反馈内容</label>
      <textarea id="beta-feedback-message" rows={5} minLength={FEEDBACK_MIN_LENGTH} maxLength={FEEDBACK_MAX_LENGTH} required value={message} disabled={sending} onChange={event => { setMessage(event.target.value); clearPrepared(); }} aria-describedby="beta-feedback-length" placeholder="发生了什么？你原本希望怎样？请描述能帮助复现的操作。" />
      <small id="beta-feedback-length">{message.length} / {FEEDBACK_MAX_LENGTH} 字，至少 {FEEDBACK_MIN_LENGTH} 字</small>
      <label className="beta-feedback__toggle"><input type="checkbox" checked={includeDiagnostics} disabled={sending} onChange={event => { setIncludeDiagnostics(event.target.checked); clearPrepared(); }} />主动附带诊断信息</label>
      <small>不会附带完整存档、网址、截图、设备唯一标识或错误原文。</small>
      {includeDiagnostics && <div className="beta-feedback__diagnostics"><p>将附带以下全部诊断信息；未测得的数值为 null（N/A）：</p><pre aria-label="待附带的诊断信息">{JSON.stringify(safeDiagnostics, null, 2)}</pre></div>}
      <button className="primary-button" type="submit" disabled={sending}>{sending ? '正在处理…' : adapter.mode === 'manual' ? '生成反馈文本' : '发送反馈'}</button>
    </form>
    {notice && <p className="beta-feedback__notice" role="status">{notice}</p>}
    {prepared && <section className="beta-feedback__prepared" aria-label="手动反馈文本"><label htmlFor="beta-feedback-output">即将复制或下载的完整内容</label><textarea id="beta-feedback-output" ref={output} readOnly rows={9} value={prepared} /><div className="dialog-actions"><button className="secondary-button" type="button" onClick={() => { void copy(); }}>复制反馈文本</button><button className="secondary-button" type="button" onClick={download}>下载反馈文本</button></div></section>}
  </div>;
}
