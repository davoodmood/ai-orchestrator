import { IVideoRenderer } from '../../application/interfaces/IVideoRenderer';
import { Shot } from '../../domain/models/Shot';

export class MockVeoAdapter implements IVideoRenderer {
  async renderShot(shot: Shot): Promise<string> {
    // Simulate 5 second delay
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Return a placeholder URL (e.g. a random video from a placeholder service or just a string)
    return `https://placehold.co/video/${shot.id}.mp4`;
  }
}
