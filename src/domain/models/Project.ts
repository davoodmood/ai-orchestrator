import { ScreenplaySegment } from './ScreenplaySegment';
import { Shot } from './Shot';

export enum ProjectStatus {
  DRAFT = 'DRAFT',
  SCRIPT_LOCKED = 'SCRIPT_LOCKED',
  SHOT_LIST_GENERATED = 'SHOT_LIST_GENERATED',
  RENDERING = 'RENDERING',
  COMPLETED = 'COMPLETED'
}

export class Project {
  constructor(
    public readonly id: string,
    public status: ProjectStatus,
    public screenplay: ScreenplaySegment[],
    public shotList: Shot[],
    public readonly createdAt: Date,
    public updatedAt: Date
  ) {}

  // Domain Logic placeholders
  updateScreenplay(segments: ScreenplaySegment[]): void {
    this.screenplay = segments;
    this.updatedAt = new Date();
  }

  generateShotList(shots: Shot[]): void {
    this.shotList = shots;
    this.status = ProjectStatus.SHOT_LIST_GENERATED;
    this.updatedAt = new Date();
  }

  updateShot(shotId: string, updatedShot: Shot): void {
    const index = this.shotList.findIndex(s => s.id === shotId);
    if (index !== -1) {
      this.shotList[index] = updatedShot;
      this.updatedAt = new Date();
    }
  }

  lockForRendering(): void {
    this.status = ProjectStatus.RENDERING;
    this.updatedAt = new Date();
  }
}
