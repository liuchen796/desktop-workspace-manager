import { CheckCircle2, CircleHelp, FolderOpen, Link2, Play, Search } from 'lucide-react';
import guideImage from '../assets/everything-configuration-guide.png';
import { Modal } from './Modal';

const STEPS = [
  { icon: Search, title: '确认 Everything 安装目录', text: '右键 Everything 快捷方式，打开“属性 > 快捷方式”，查看“目标”或“起始位置”。常见目录是 C:\\Program Files\\Everything。' },
  { icon: FolderOpen, title: '在工作台选择目录', text: '点击连接状态中的目录设置图标，选择直接包含 Everything.exe 的文件夹。不要选择快捷方式文件，也不要选择它的上级或子目录。' },
  { icon: Link2, title: '完成搜索连接', text: '首次配置若显示“需要搜索连接器”，点击“完成连接”。工作台会准备与 Everything 本机索引通信所需的官方 ES 连接器。' },
  { icon: Play, title: '启动并确认连接', text: '点击“启动 Everything”，等待状态显示“已连接”。随后输入文件名即可搜索所有已建立索引的磁盘。' },
];

export function EverythingGuideDialog({ onClose }: { onClose: () => void }) {
  return <Modal title="Everything 配置说明" onClose={onClose} wide>
    <div className="everything-guide-content">
      <div className="everything-guide-intro"><CircleHelp size={21} /><span><strong>只需要选择一次正确的安装目录</strong><small>配置会自动保存，以后可直接在主窗口或快速面板中搜索。</small></span></div>
      <figure className="everything-guide-figure"><img src={guideImage} alt="Everything 快捷方式属性和安装目录选择示意图" /><figcaption>示意图：从快捷方式属性确认起始位置，再在工作台中选择同一个 Everything 安装目录。</figcaption></figure>
      <section className="everything-guide-steps" aria-label="Everything 配置步骤">
        {STEPS.map(({ icon: Icon, title, text }, index) => <div className="everything-guide-step" key={title}><span className="everything-guide-step-number">{index + 1}</span><span className="everything-guide-step-icon"><Icon size={18} /></span><span><strong>{title}</strong><small>{text}</small></span></div>)}
      </section>
      <div className="everything-guide-notes"><CheckCircle2 size={18} /><span><strong>便携版同样支持</strong><small>如果 Everything 没有安装在 Program Files，直接选择实际存放 Everything.exe 的便携版文件夹即可。若连接后没有结果，请先让 Everything 完成首次索引。</small></span></div>
    </div>
    <footer className="modal-footer"><button className="primary-button" onClick={onClose}>我知道了</button></footer>
  </Modal>;
}
