import { IProjectRepository } from '../../domain/repositories/IProjectRepository';
import { IAIService } from '../interfaces/IAIService';
import { Project } from '../../domain/models/Project';

export class GenerateDraft {
  constructor(
    private projectRepo: IProjectRepository,
    private aiService: IAIService
  ) {}

  async execute(projectId: string, concept: string): Promise<Project> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new Error('Project not found');

    const screenplay = await this.aiService.generateScreenplay(concept);
    project.updateScreenplay(screenplay);

    const shotList = await this.aiService.generateShotList(screenplay);
    project.generateShotList(shotList);

    await this.projectRepo.save(project);
    return project;
  }
}
