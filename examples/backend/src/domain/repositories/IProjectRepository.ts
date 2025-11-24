import { Project } from '../models/Project';

export interface IProjectRepository {
  findById(id: string): Promise<Project | null>;
  save(project: Project): Promise<void>;
  delete(id: string): Promise<void>;
}
