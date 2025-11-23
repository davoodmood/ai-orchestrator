import { IProjectRepository } from '../../domain/repositories/IProjectRepository';
import { Project } from '../../domain/models/Project';

export class UpdateShotManual {
  constructor(private projectRepo: IProjectRepository) {}

  async execute(projectId: string, shotId: string, visualPrompt: string): Promise<Project> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new Error('Project not found');

    const shot = project.shotList.find(s => s.id === shotId);
    if (!shot) throw new Error('Shot not found');

    shot.updatePrompt(visualPrompt);
    project.updateShot(shotId, shot);

    await this.projectRepo.save(project);
    return project;
  }
}
