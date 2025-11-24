import { IProjectRepository } from '../../domain/repositories/IProjectRepository';
import { Project } from '../../domain/models/Project';
import fs from 'fs/promises';
import path from 'path';

export class FileSystemProjectRepository implements IProjectRepository {
  private storagePath: string;

  constructor(storageDir: string = './data') {
    this.storagePath = path.join(storageDir, 'projects.json');
    this.ensureStorage();
  }

  private async ensureStorage() {
    try {
      await fs.mkdir(path.dirname(this.storagePath), { recursive: true });
      try {
        await fs.access(this.storagePath);
      } catch {
        await fs.writeFile(this.storagePath, JSON.stringify({}));
      }
    } catch (error) {
      console.error('Failed to initialize storage:', error);
    }
  }

  private async readAll(): Promise<Record<string, Project>> {
    try {
        await this.ensureStorage();
        const data = await fs.readFile(this.storagePath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        return {};
    }
  }

  private async writeAll(projects: Record<string, Project>): Promise<void> {
    await fs.writeFile(this.storagePath, JSON.stringify(projects, null, 2));
  }

  async findById(id: string): Promise<Project | null> {
    const projects = await this.readAll();
    const data = projects[id];
    if (!data) return null;
    // Rehydrate Project entity (simplistic)
    return new Project(
        data.id,
        data.status,
        data.screenplay,
        data.shotList,
        new Date(data.createdAt),
        new Date(data.updatedAt)
    );
  }

  async save(project: Project): Promise<void> {
    const projects = await this.readAll();
    projects[project.id] = project;
    await this.writeAll(projects);
  }

  async delete(id: string): Promise<void> {
    const projects = await this.readAll();
    delete projects[id];
    await this.writeAll(projects);
  }
}
