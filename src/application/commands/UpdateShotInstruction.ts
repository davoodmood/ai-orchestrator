import { IProjectRepository } from '../../domain/repositories/IProjectRepository';
import { IAIService } from '../interfaces/IAIService';
import { Project } from '../../domain/models/Project';

export class UpdateShotInstruction {
  constructor(
    private projectRepo: IProjectRepository,
    private aiService: IAIService
  ) {}

  async execute(projectId: string, shotId: string, instruction: string): Promise<Project> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new Error('Project not found');

    const shot = project.shotList.find(s => s.id === shotId);
    if (!shot) throw new Error('Shot not found');

    const updatedShot = await this.aiService.refineShot(shot, instruction);
    project.updateShot(shotId, updatedShot);

    await this.projectRepo.save(project);
    return project;
  }
}
