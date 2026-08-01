import { useCallback, useEffect, useState, type RefObject } from 'react';
import { AlertTriangle, AppWindow, CheckCircle2, CircleHelp, Download, File, FileText, Folder, FolderOpen, Image, LoaderCircle, Play, Search, Settings2, Video } from 'lucide-react';
import type { AppSettings, EverythingResult, EverythingStatus } from '../types';
import { EverythingGuideDialog } from './EverythingGuideDialog';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm']);
const DOCUMENT_EXTENSIONS = new Set(['.doc', '.docx', '.pdf', '.txt', '.md', '.xls', '.xlsx', '.ppt', '.pptx']);

function ResultIcon({ result }: { result: EverythingResult }) {
  if (result.icon) return <img src={result.icon} alt="" draggable={false} />;
  if (result.isDirectory) return <Folder size={24} />;
  if (IMAGE_EXTENSIONS.has(result.extension)) return <Image size={23} />;
  if (VIDEO_EXTENSIONS.has(result.extension)) return <Video size={23} />;
  if (DOCUMENT_EXTENSIONS.has(result.extension)) return <FileText size={23} />;
  if (result.extension === '.exe' || result.extension === '.lnk') return <AppWindow size={23} />;
  return <File size={23} />;
}

function formatSize(size: number | null, isDirectory: boolean) {
  if (isDirectory || size == null) return '文件夹';
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(1)} GB`;
}

function formatModified(value: number | null) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(value) : '时间未知';
}

export function EverythingSearch({ settings, setSettings, searchRef, showToast }: { settings: AppSettings; setSettings: (settings: AppSettings) => void; searchRef: RefObject<HTMLInputElement | null>; showToast: (message: string) => void }) {
  const [status, setStatus] = useState<EverythingStatus | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EverythingResult[]>([]);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [setupLoading, setSetupLoading] = useState(false);
  const [error, setError] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await window.desktopAPI.getEverythingStatus());
      setError('');
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    }
  }, []);

  useEffect(() => { void loadStatus(); }, [loadStatus]);
  useEffect(() => {
    if (status?.ready) searchRef.current?.focus();
  }, [searchRef, status?.ready]);

  const search = useCallback(async (searchQuery: string) => {
    if (!searchQuery.trim() || !status?.ready) {
      setResults([]);
      setElapsedMs(0);
      return;
    }
    setLoading(true);
    try {
      const response = await window.desktopAPI.searchEverything(searchQuery, settings.everythingResultLimit);
      setResults(response.results);
      setElapsedMs(response.elapsedMs);
      setSelectedId(response.results[0]?.id || null);
      setError('');
    } catch (nextError) {
      setResults([]);
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setLoading(false);
    }
  }, [settings.everythingResultLimit, status?.ready]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void search(query); }, 280);
    return () => window.clearTimeout(timer);
  }, [query, search]);

  const runSetup = async (task: () => Promise<EverythingStatus | null>, success: string) => {
    setSetupLoading(true);
    try {
      const next = await task();
      if (next) {
        setStatus(next);
        setError('');
        showToast(success);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setSetupLoading(false);
    }
  };

  const openResult = async (result: EverythingResult) => {
    try { await window.desktopAPI.openEverythingResult(result.id); } catch (nextError) { showToast(nextError instanceof Error ? nextError.message : String(nextError)); }
  };

  return <div className="everything-page">
    <header className="everything-header">
      <div className="heading-group"><h1>Everything 搜索</h1><p>使用本机 Everything 索引查找文件与文件夹</p></div>
      <div className="everything-header-tools">
        <div className={`everything-connection ${status?.running ? 'ready' : ''}`}>
          {status?.running ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
          <span>{status?.running ? `已连接${status.everythingVersion ? ` · Everything ${status.everythingVersion}` : ''}` : status?.ready ? '已配置，Everything 未运行' : '尚未完成连接'}</span>
          <button className="icon-button" title="重新选择 Everything 目录" onClick={() => runSetup(() => window.desktopAPI.chooseEverythingDirectory(), 'Everything 目录已更新')}><Settings2 size={17} /></button>
        </div>
        <button className="everything-guide-button" onClick={() => setGuideOpen(true)}><CircleHelp size={16} />配置说明</button>
      </div>
    </header>

    {!status?.ready && <section className="everything-setup">
      <div className="everything-setup-icon"><Search size={25} /></div>
      <div><strong>{status?.everythingExists ? '已找到 Everything，需要安装搜索连接器' : '选择 Everything 安装目录'}</strong><span>{status?.effectivePath || '请选择包含 Everything.exe 的文件夹'}</span></div>
      {status?.everythingExists
        ? <button className="primary-button" disabled={setupLoading} onClick={() => runSetup(() => window.desktopAPI.installEverythingConnector(), 'Everything 搜索连接器已就绪')}>{setupLoading ? <LoaderCircle className="spin" size={17} /> : <Download size={17} />}完成连接</button>
        : <button className="primary-button" disabled={setupLoading} onClick={() => runSetup(() => window.desktopAPI.chooseEverythingDirectory(), 'Everything 目录已选择')}><FolderOpen size={17} />选择目录</button>}
    </section>}

    <form className="everything-searchbar" onSubmit={(event) => { event.preventDefault(); void search(query); }}>
      <Search size={21} />
      <input ref={searchRef} value={query} disabled={!status?.ready} onChange={(event) => setQuery(event.target.value)} placeholder={status?.ready ? '搜索所有磁盘，例如：*.docx  客户名称  dm:today' : '完成 Everything 连接后即可搜索'} aria-label="Everything 搜索" />
      {loading && <LoaderCircle className="spin" size={18} />}
      <select aria-label="搜索结果数量" value={settings.everythingResultLimit} onChange={async (event) => {
        const everythingResultLimit = Number(event.target.value) as AppSettings['everythingResultLimit'];
        setSettings(await window.desktopAPI.updateSettings({ everythingResultLimit }));
      }}><option value="50">50 条</option><option value="100">100 条</option><option value="200">200 条</option></select>
      <button className="primary-button" disabled={!status?.ready || !query.trim() || loading} type="submit">搜索</button>
    </form>

    <div className="everything-result-head"><span>{query.trim() ? `${results.length} 个结果 · ${elapsedMs} ms` : '输入关键词开始搜索'}</span>{status?.everythingExists && <button onClick={() => runSetup(() => window.desktopAPI.startEverything(), 'Everything 已启动')}><Play size={15} />启动 Everything</button>}</div>
    {error && <div className="everything-error" role="alert"><AlertTriangle size={17} />{error}{status?.everythingExists && error.includes('尚未运行') && <button onClick={() => runSetup(() => window.desktopAPI.startEverything(), 'Everything 已启动')}>立即启动</button>}</div>}

    <section className="everything-results" aria-busy={loading} aria-live="polite">
      {results.map((result) => <article key={result.id} tabIndex={0} className={`everything-result ${selectedId === result.id ? 'selected' : ''}`} onClick={() => setSelectedId(result.id)} onDoubleClick={() => openResult(result)} onKeyDown={(event) => { if (event.key === 'Enter') void openResult(result); }}>
        <div className="everything-result-icon"><ResultIcon result={result} /></div>
        <div className="everything-result-main"><strong title={result.name}>{result.name}</strong><span title={result.directory}>{result.directory}</span></div>
        <span>{formatSize(result.size, result.isDirectory)}</span>
        <span>{formatModified(result.modifiedAt)}</span>
        <div className="everything-result-actions"><button title="打开" onClick={(event) => { event.stopPropagation(); void openResult(result); }}><FolderOpen size={17} /></button><button title="在资源管理器中显示" onClick={async (event) => { event.stopPropagation(); try { await window.desktopAPI.revealEverythingResult(result.id); } catch (nextError) { showToast(nextError instanceof Error ? nextError.message : String(nextError)); } }}><Search size={17} /></button></div>
      </article>)}
      {!loading && status?.ready && query.trim() && !results.length && !error && <div className="everything-empty"><Search size={28} /><strong>没有找到匹配结果</strong><span>可以尝试缩短关键词或使用 Everything 搜索语法</span></div>}
      {!loading && status?.ready && !query.trim() && <div className="everything-empty"><Search size={28} /><strong>搜索已就绪</strong><span>支持文件名、路径、扩展名和 Everything 高级语法</span></div>}
    </section>
    {guideOpen && <EverythingGuideDialog onClose={() => setGuideOpen(false)} />}
  </div>;
}
