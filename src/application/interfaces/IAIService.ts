import { ScreenplaySegment } from '../../domain/models/ScreenplaySegment';
import { Shot } from '../../domain/models/Shot';

export interface IAIService {
  generateScreenplay(concept: string): Promise<ScreenplaySegment[]>;
  generateShotList(screenplay: ScreenplaySegment[]): Promise<Shot[]>;
  refineShot(shot: Shot, instruction: string): Promise<Shot>;
}
