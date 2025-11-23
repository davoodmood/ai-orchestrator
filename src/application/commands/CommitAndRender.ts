import { IProjectRepository } from '../../domain/repositories/IProjectRepository';
import { IVideoRenderer } from '../interfaces/IVideoRenderer';
import { Project, ProjectStatus } from '../../domain/models/Project';
import { ShotStatus } from '../../domain/models/Shot';

export class CommitAndRender {
  constructor(
    private projectRepo: IProjectRepository,
    private videoRenderer: IVideoRenderer
  ) {}

  async execute(projectId: string): Promise<Project> {
    const project = await this.projectRepo.findById(projectId);
    if (!project) throw new Error('Project not found');

    // Validate that we can render (e.g. shots exist)
    if (project.shotList.length === 0) {
        throw new Error('Cannot render empty shot list');
    }

    project.lockForRendering();
    
    // Fire and forget rendering jobs (or await if we want to block)
    // In a real system, this would probably queue jobs. 
    // Here we'll just iterate and start them.
    
    const renderPromises = project.shotList.map(async (shot) => {
        shot.status = ShotStatus.RENDERING;
        // Save intermediate state if needed, or just keep in memory for now
        try {
            const url = await this.videoRenderer.renderShot(shot);
            shot.renderUrl = url;
            shot.status = ShotStatus.RENDERED;
        } catch (e) {
            console.error(`Failed to render shot ${shot.id}`, e);
            // handle error
        }
    });

    // We won't await all renders here to return the "Rendering" status quickly,
    // but we need to make sure the status is saved.
    // Actually, if we don't await, the lambda/process might die.
    // For this MVP, let's await them or assume we have a background worker.
    // Given "MockVeoAdapter simulates delay", if we await, the HTTP request will timeout.
    // But since I am an agent, I'll just trigger them.
    // To keep it simple for the user's "Pragmatic" request, I will NOT await all of them in the response,
    // but I need to make sure `project.save` is called.
    
    // Let's update status to RENDERING and save.
    await this.projectRepo.save(project);

    // Start rendering in background (this is risky in serverless but fine for a long-running process)
    Promise.all(renderPromises).then(async () => {
        project.status = ProjectStatus.COMPLETED; // Simplified
        await this.projectRepo.save(project);
    });

    return project;
  }
}
