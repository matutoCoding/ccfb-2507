import { useSyncExternalStore } from 'react';
import type { Operation, Project } from './types';
import { createProject, insertOperation, removeOperation } from './project';

/**
 * 轻量全局 store（无第三方依赖）。
 * 状态不可变更新 + 版本号；撤销/重做通过操作快照栈实现。
 */
export interface StudioState {
  project: Project;
  selectedOpId: string | null;
  lightTilt: number;
  samples: 1 | 4;
  history: Project[];
  future: Project[];
}

type Listener = () => void;

const MAX_HISTORY = 50;

class StudioStore {
  private state: StudioState = {
    project: createProject(),
    selectedOpId: null,
    lightTilt: 0.4,
    samples: 1,
    history: [],
    future: [],
  };
  private listeners = new Set<Listener>();

  getState = (): StudioState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<StudioState>, trackHistory = false) {
    if (trackHistory) {
      const history = [...this.state.history, this.state.project].slice(-MAX_HISTORY);
      this.state = { ...this.state, ...patch, history, future: [] };
    } else {
      this.state = { ...this.state, ...patch };
    }
    this.listeners.forEach((l) => l());
  }

  /** 结构性变更（工序、调色板、纸张）入历史栈 */
  commitProject(project: Project) {
    this.set({ project }, true);
  }

  patchProject(patch: Partial<Project>, track = false) {
    this.set({ project: { ...this.state.project, ...patch } }, track);
  }

  setLightTilt(v: number) {
    this.set({ lightTilt: Math.max(0, Math.min(1, v)) });
  }

  setSamples(s: 1 | 4) {
    this.set({ samples: s });
  }

  selectOp(id: string | null) {
    this.set({ selectedOpId: id });
  }

  addOperation(op: Operation, atIndex?: number) {
    const operations = insertOperation(this.state.project.operations, op, atIndex);
    this.commitProject({ ...this.state.project, operations });
    this.set({ selectedOpId: op.id });
  }

  deleteOperation(id: string) {
    const operations = removeOperation(this.state.project.operations, id);
    this.commitProject({ ...this.state.project, operations });
    if (this.state.selectedOpId === id) this.set({ selectedOpId: null });
  }

  undo() {
    const prev = this.state.history.at(-1);
    if (!prev) return;
    const history = this.state.history.slice(0, -1);
    this.set({
      project: prev,
      history,
      future: [this.state.project, ...this.state.future].slice(0, MAX_HISTORY),
      selectedOpId: null,
    });
  }

  redo() {
    const next = this.state.future[0];
    if (!next) return;
    this.set({
      project: next,
      future: this.state.future.slice(1),
      history: [...this.state.history, this.state.project].slice(-MAX_HISTORY),
      selectedOpId: null,
    });
  }

  loadProject(project: Project) {
    this.set({ project, history: [], future: [], selectedOpId: null }, true);
  }
}

export const studioStore = new StudioStore();

export function useStudio(): StudioState {
  return useSyncExternalStore(studioStore.subscribe, studioStore.getState);
}
