import { IAIService } from '../../application/interfaces/IAIService';
import { ScreenplaySegment } from '../../domain/models/ScreenplaySegment';
import { Shot, ShotStatus } from '../../domain/models/Shot';

export class MockAIAdapter implements IAIService {
  async generateScreenplay(concept: string): Promise<ScreenplaySegment[]> {
    return [
      {
        id: 'seg-1',
        character: 'Narrator',
        dialogue: 'In a world where coffee is infinite...',
        action: 'Camera pans over a golden coffee bean field.',
        orderIndex: 1
      },
      {
        id: 'seg-2',
        character: 'Hero',
        dialogue: 'I need a cup.',
        action: 'Hero looks at the horizon determined.',
        orderIndex: 2
      }
    ];
  }

  async generateShotList(screenplay: ScreenplaySegment[]): Promise<Shot[]> {
    return screenplay.map((seg, index) => new Shot(
      `shot-${index + 1}`,
      `Cinematic shot of ${seg.action}`,
      { type: 'WIDE' },
      3000,
      ShotStatus.DRAFT,
      undefined,
      index
    ));
  }

  async refineShot(shot: Shot, instruction: string): Promise<Shot> {
    // Return a new shot instance with updated prompt
    return new Shot(
      shot.id,
      `${shot.visualPrompt} (Refined: ${instruction})`,
      shot.cameraAngle,
      shot.durationMs,
      shot.status,
      shot.renderUrl,
      shot.sequenceIndex
    );
  }
}
