import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

interface DependencyResult {
  success: boolean;
  message: string;
  dependencies?: string[];
  lockFileGenerated?: boolean;
}

export class DependencyManager {
  /**
   * Detects and installs dependencies for a bot directory
   * Supports JavaScript/TypeScript (package.json) and Python (requirements.txt)
   */
  async detectAndInstallDependencies(botPath: string, botId: string): Promise<DependencyResult> {
    try {
      // Check for package.json (JavaScript/TypeScript)
      const packageJsonPath = path.join(botPath, 'package.json');
      const requirementsPath = path.join(botPath, 'requirements.txt');
      
      const hasPackageJson = await this.fileExists(packageJsonPath);
      const hasRequirements = await this.fileExists(requirementsPath);
      
      if (hasPackageJson) {
        return await this.installNodeDependencies(botPath, packageJsonPath, botId);
      } else if (hasRequirements) {
        return await this.installPythonDependencies(botPath, requirementsPath, botId);
      } else {
        return {
          success: true,
          message: 'No dependency files found (package.json or requirements.txt). Bot ready to run.',
        };
      }
    } catch (error) {
      return {
        success: false,
        message: `Dependency detection failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Install Node.js dependencies using npm with security hardening
   */
  private async installNodeDependencies(botPath: string, packageJsonPath: string, botId: string): Promise<DependencyResult> {
    try {
      // Read and validate package.json
      const packageContent = await fs.readFile(packageJsonPath, 'utf-8');
      const packageData = JSON.parse(packageContent);
      
      const dependencies = {
        ...packageData.dependencies,
        ...packageData.devDependencies,
      };
      
      const dependencyList = Object.keys(dependencies);
      
      if (dependencyList.length === 0) {
        return {
          success: true,
          message: 'package.json found but no dependencies to install',
          dependencies: [],
        };
      }

      console.log(`[Bot ${botId}] Installing Node.js dependencies (secure mode): ${dependencyList.join(', ')}`);
      
      // Check if package-lock.json exists for deterministic installs
      const lockFileExists = await this.fileExists(path.join(botPath, 'package-lock.json'));
      
      let installResult;
      if (lockFileExists) {
        // Use npm ci for secure, deterministic installs when lockfile exists
        console.log(`[Bot ${botId}] Using npm ci (secure mode)`);
        installResult = await this.runCommand('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], botPath);
      } else {
        // Use npm install with security flags to prevent script execution
        console.log(`[Bot ${botId}] Using npm install with security flags`);
        installResult = await this.runCommand('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', '--no-fund'], botPath);
      }
      
      if (!installResult.success) {
        return {
          success: false,
          message: `npm install failed: ${installResult.error}`,
        };
      }

      // Check if package-lock.json was generated (if it didn't exist before)
      const lockFileExistsAfter = await this.fileExists(path.join(botPath, 'package-lock.json'));
      
      return {
        success: true,
        message: `Successfully installed ${dependencyList.length} Node.js dependencies (secure mode)`,
        dependencies: dependencyList,
        lockFileGenerated: lockFileExistsAfter,
      };
    } catch (error) {
      return {
        success: false,
        message: `Node.js dependency installation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Install Python dependencies using pip with virtual environment isolation
   */
  private async installPythonDependencies(botPath: string, requirementsPath: string, botId: string): Promise<DependencyResult> {
    try {
      // Read requirements.txt
      const requirementsContent = await fs.readFile(requirementsPath, 'utf-8');
      const dependencies = requirementsContent
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(line => line.split('==')[0].split('>=')[0].split('<=')[0].split('>')[0].split('<')[0]);

      if (dependencies.length === 0) {
        return {
          success: true,
          message: 'requirements.txt found but no dependencies to install',
          dependencies: [],
        };
      }

      console.log(`[Bot ${botId}] Installing Python dependencies in virtual environment: ${dependencies.join(', ')}`);
      
      const venvPath = path.join(botPath, 'venv');
      
      // Create virtual environment
      console.log(`[Bot ${botId}] Creating Python virtual environment`);
      const venvResult = await this.runCommand('python3', ['-m', 'venv', 'venv'], botPath);
      
      if (!venvResult.success) {
        // Try with python if python3 fails
        const fallbackVenv = await this.runCommand('python', ['-m', 'venv', 'venv'], botPath);
        if (!fallbackVenv.success) {
          return {
            success: false,
            message: `Failed to create virtual environment: ${venvResult.error || fallbackVenv.error}`,
          };
        }
      }

      // Determine pip path in virtual environment
      const pipPath = process.platform === 'win32' 
        ? path.join(venvPath, 'Scripts', 'pip')
        : path.join(venvPath, 'bin', 'pip');

      // Install dependencies in virtual environment with security flags
      console.log(`[Bot ${botId}] Installing dependencies in virtual environment`);
      const installResult = await this.runCommand(pipPath, [
        'install', 
        '-r', 
        'requirements.txt',
        '--only-binary=:all:', // Only use pre-built wheels to prevent code execution
        '--no-cache-dir',      // Don't use cache to ensure clean installs
        '--require-virtualenv' // Ensure we're in a virtual environment
      ], botPath);
      
      if (!installResult.success) {
        // Security: Do NOT fallback to source builds to prevent code execution
        // If wheels are not available, fail securely rather than allow arbitrary code execution
        console.log(`[Bot ${botId}] pip install failed with --only-binary restriction`);
        return {
          success: false,
          message: `pip install failed - pre-built wheels not available for all dependencies (security restriction): ${installResult.error}`,
        };
      }

      // Generate requirements lock file for reproducibility
      console.log(`[Bot ${botId}] Generating requirements lock file`);
      const freezeResult = await this.runCommand(pipPath, ['freeze'], botPath);
      if (freezeResult.success && freezeResult.output) {
        const lockFilePath = path.join(botPath, 'requirements.lock');
        await fs.writeFile(lockFilePath, freezeResult.output);
      }

      return {
        success: true,
        message: `Successfully installed ${dependencies.length} Python dependencies in isolated virtual environment`,
        dependencies,
        lockFileGenerated: freezeResult.success,
      };
    } catch (error) {
      return {
        success: false,
        message: `Python dependency installation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }
  }

  /**
   * Run a shell command and return the result
   */
  private async runCommand(command: string, args: string[], cwd: string): Promise<{
    success: boolean;
    output?: string;
    error?: string;
  }> {
    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd,
        stdio: 'pipe',
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('exit', (code) => {
        if (code === 0) {
          resolve({
            success: true,
            output: stdout.trim(),
          });
        } else {
          resolve({
            success: false,
            error: stderr.trim() || stdout.trim() || `Command exited with code ${code}`,
          });
        }
      });

      child.on('error', (error) => {
        resolve({
          success: false,
          error: error.message,
        });
      });

      // Set timeout with escalating signals
      const timeout = setTimeout(() => {
        if (!child.killed) {
          console.log(`[DependencyManager] Sending SIGTERM to ${command} (timeout)`);
          child.kill('SIGTERM');
          
          // Force kill after additional 10 seconds
          const forceKillTimeout = setTimeout(() => {
            if (!child.killed) {
              console.log(`[DependencyManager] Force killing ${command} with SIGKILL`);
              child.kill('SIGKILL');
              resolve({
                success: false,
                error: 'Command force-killed after timeout',
              });
            }
          }, 10000);
          
          // Clear force-kill timeout if process exits naturally
          child.once('exit', () => {
            clearTimeout(forceKillTimeout);
          });
        }
      }, 5 * 60 * 1000); // 5 minutes timeout
      
      // Clear timeout when process exits
      child.on('exit', () => {
        clearTimeout(timeout);
      });
    });
  }

  /**
   * Check if a file exists
   */
  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate dependency report for a bot
   */
  async getDependencyInfo(botPath: string): Promise<{
    hasPackageJson: boolean;
    hasRequirements: boolean;
    hasLockFiles: boolean;
    dependencies: string[];
  }> {
    const packageJsonPath = path.join(botPath, 'package.json');
    const requirementsPath = path.join(botPath, 'requirements.txt');
    const packageLockPath = path.join(botPath, 'package-lock.json');
    
    const hasPackageJson = await this.fileExists(packageJsonPath);
    const hasRequirements = await this.fileExists(requirementsPath);
    const hasLockFiles = await this.fileExists(packageLockPath);
    
    let dependencies: string[] = [];
    
    try {
      if (hasPackageJson) {
        const packageContent = await fs.readFile(packageJsonPath, 'utf-8');
        const packageData = JSON.parse(packageContent);
        dependencies = Object.keys({
          ...packageData.dependencies,
          ...packageData.devDependencies,
        });
      } else if (hasRequirements) {
        const requirementsContent = await fs.readFile(requirementsPath, 'utf-8');
        dependencies = requirementsContent
          .split('\n')
          .map(line => line.trim())
          .filter(line => line && !line.startsWith('#'))
          .map(line => line.split('==')[0].split('>=')[0].split('<=')[0]);
      }
    } catch (error) {
      console.error('Error reading dependency files:', error);
    }
    
    return {
      hasPackageJson,
      hasRequirements,
      hasLockFiles,
      dependencies,
    };
  }
}

export const dependencyManager = new DependencyManager();