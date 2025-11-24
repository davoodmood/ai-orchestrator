import { Shot } from '../../domain/models/Shot';

export interface IVideoRenderer {
  renderShot(shot: Shot): Promise<string>; // Returns the URL of the rendered video
}
