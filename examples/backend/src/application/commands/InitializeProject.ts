import { IProjectRepository } from '../../domain/repositories/IProjectRepository';
import { Project, ProjectStatus } from '../../domain/models/Project';
import { v4 as uuidv4 } from 'uuid';

export class InitializeProject {
  constructor(private projectRepo: IProjectRepository) {}

  async execute(): Promise<Project> {
    const id = uuidv4();
    const project = new Project(
      id,
      ProjectStatus.DRAFT,
      [],
      [],
      new Date(),
      new Date()
    );
    await this.projectRepo.save(project);
    return project;
  }
}
