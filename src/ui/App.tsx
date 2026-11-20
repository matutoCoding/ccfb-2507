import { useState } from 'react';
import { LibraryPage } from './pages/LibraryPage';
import { BenchPage } from './pages/BenchPage';
import { PalettePage } from './pages/PalettePage';
import { MatchPage } from './pages/MatchPage';
import { PrintPage } from './pages/PrintPage';
import { TestLabPage } from './pages/TestLabPage';

export type PageId = 'library' | 'bench' | 'palette' | 'match' | 'print' | 'testlab';

const NAV: Array<{ id: PageId; name: string }> = [
  { id: 'library', name: '纹样库' },
  { id: 'bench', name: '浮染操作台' },
  { id: 'palette', name: '颜料配色' },
  { id: 'match', name: '老纸比对' },
  { id: 'print', name: '印刷输出' },
  { id: 'testlab', name: '确定性自测' },
];

export function App() {
  const [page, setPage] = useState<PageId>('bench');
  return (
    <div className="app">
      <header className="app-header">
        <h1>
          浮染坊
          <small>大理石纹纸设计系统 · Ebru Marbling Studio</small>
        </h1>
        <nav className="nav">
          {NAV.map((n) => (
            <button key={n.id} className={page === n.id ? 'active' : ''} onClick={() => setPage(n.id)}>
              {n.name}
            </button>
          ))}
        </nav>
        <div className="header-spacer" />
        <span className="muted">工序化建模 · 确定性重放 · 600dpi 矢量级输出</span>
      </header>
      <div className="app-body">
        {page === 'library' && <LibraryPage onOpen={() => setPage('bench')} />}
        {page === 'bench' && <BenchPage />}
        {page === 'palette' && <PalettePage />}
        {page === 'match' && <MatchPage />}
        {page === 'print' && <PrintPage />}
        {page === 'testlab' && <TestLabPage />}
      </div>
    </div>
  );
}
