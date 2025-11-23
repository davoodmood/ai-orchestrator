import express from 'express';
import cors from 'cors';
import path from 'path';
import { FileSystemProjectRepository } from './infrastructure/persistence/FileSystemProjectRepository';
import { MockAIAdapter } from './infrastructure/ai/MockAIAdapter';
import { MockVeoAdapter } from './infrastructure/video/MockVeoAdapter';
import { InitializeProject } from './application/commands/InitializeProject';
import { GenerateDraft } from './application/commands/GenerateDraft';
import { UpdateShotInstruction } from './application/commands/UpdateShotInstruction';
import { UpdateShotManual } from './application/commands/UpdateShotManual';
import { CommitAndRender } from './application/commands/CommitAndRender';

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../examples')));

// Dependencies
const projectRepo = new FileSystemProjectRepository();
const aiService = new MockAIAdapter();
const videoRenderer = new MockVeoAdapter();

// Use Cases
const initializeProject = new InitializeProject(projectRepo);
const generateDraft = new GenerateDraft(projectRepo, aiService);
const updateShotInstruction = new UpdateShotInstruction(projectRepo, aiService);
const updateShotManual = new UpdateShotManual(projectRepo);
const commitAndRender = new CommitAndRender(projectRepo, videoRenderer);

// Routes
app.post('/api/projects', async (req, res) => {
  try {
    const project = await initializeProject.execute();
    res.json(project);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects/:id/generate', async (req, res) => {
  try {
    const { concept } = req.body;
    const project = await generateDraft.execute(req.params.id, concept);
    res.json(project);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/projects/:id/shots/:shotId', async (req, res) => {
  try {
    const { instruction } = req.body;
    const project = await updateShotInstruction.execute(req.params.id, req.params.shotId, instruction);
    res.json(project);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/projects/:id/shots/:shotId', async (req, res) => {
  try {
    const { visualPrompt } = req.body;
    const project = await updateShotManual.execute(req.params.id, req.params.shotId, visualPrompt);
    res.json(project);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/projects/:id/render', async (req, res) => {
  try {
    const project = await commitAndRender.execute(req.params.id);
    res.json(project);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/projects/:id', async (req, res) => {
    try {
        const project = await projectRepo.findById(req.params.id);
        if (!project) {
            res.status(404).json({ error: 'Project not found' });
            return;
        }
        res.json(project);
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
