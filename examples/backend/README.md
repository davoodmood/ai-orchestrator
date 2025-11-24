# AI Orchestrator Backend Example

This is a sample backend implementation using the Pragmatic DDD architecture.

## Setup

1.  Install dependencies in the root workspace:
    ```bash
    npm install
    ```

## Running the Server

1.  Navigate to this directory:
    ```bash
    cd examples/backend
    ```

2.  Run the server:
    ```bash
    npx ts-node src/server.ts
    ```
    
    *Note: Since dependencies are installed in the root, `npx` should find `ts-node` and `express` correctly.*

3.  Open `http://localhost:3000/dashboard/` in your browser.

## Project Structure

-   `src/domain`: Core business logic (Entities, Repositories).
-   `src/application`: Use Cases and Orchestration logic.
-   `src/infrastructure`: Adapters for persistence and external services (AI, Video).
-   `src/server.ts`: Express API entry point.
