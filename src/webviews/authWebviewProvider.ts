import * as vscode from 'vscode';
import { AuthenticationProvider } from '../auth/AuthenticationProvider';
import { getNonce } from '../utils';
import fetch, { Response } from 'node-fetch';
import { URLSearchParams } from 'url';

// Combined message types
interface LoginMessage {
    type: 'login';
    username: string;
    password: string;
}

interface RegisterMessage {
    type: 'register';
    username: string;
    email: string;
    password: string;
}

interface ErrorMessage {
    type: 'error';
    message: string;
}

interface ViewChangeMessage {
    type: 'viewChange';
    view: 'login' | 'register';
}

type WebviewMessage = LoginMessage | RegisterMessage | ErrorMessage | ViewChangeMessage;

export class AuthWebviewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private currentView: 'login' | 'register' = 'login';

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly authProvider: AuthenticationProvider,
        private apiEndpoint: string
    ) { }

    resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data: WebviewMessage) => {
            switch (data.type) {
                case 'login':
                    await this.handleLogin(data, webviewView);
                    break;
                case 'register':
                    await this.handleRegister(data, webviewView);
                    break;
                case 'viewChange':
                    this.currentView = data.view;
                    webviewView.webview.html = this.getHtmlContent(webviewView.webview);
                    break;
            }
        });
    }

    private async handleLogin(data: LoginMessage, webviewView: vscode.WebviewView) {
        try {
            const formData = new URLSearchParams({
                username: data.username,
                password: data.password,
                grant_type: 'password',
                scope: ''
            });

            const response = await fetch(`${this.apiEndpoint}/auth/token`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json',
                },
                body: formData
            });

            const result = await this.handleResponse(response);
            await this.authProvider.setToken((result as any).access_token);
            vscode.window.showInformationMessage('Successfully logged in!');

        } catch (error: unknown) {
            this.handleError(error, webviewView);
        }
    }

    private async handleRegister(data: RegisterMessage, webviewView: vscode.WebviewView) {
        try {
            this.validatePassword(data.password);

            const response = await fetch(`${this.apiEndpoint}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                },
                body: JSON.stringify({
                    username: data.username,
                    email: data.email,
                    password: data.password,
                }),
            });

            const result = await this.handleResponse(response);
            await this.authProvider.setToken(result.access_token);
            vscode.window.showInformationMessage('Successfully registered!');

        } catch (error: unknown) {
            this.handleError(error, webviewView);
        }
    }

    private validatePassword(password: string): void {
        if (password.length < 8) {
            throw new Error('Password must be at least 8 characters long');
        }
        if (!/[A-Z]/.test(password)) {
            throw new Error('Password must contain at least one uppercase letter');
        }
        if (!/[a-z]/.test(password)) {
            throw new Error('Password must contain at least one lowercase letter');
        }
        if (!/[0-9]/.test(password)) {
            throw new Error('Password must contain at least one number');
        }
    }

    private async handleResponse(response: Response) {
        const rawText = await response.text();
        let result;
        try {
            result = JSON.parse(rawText);
        } catch (parseError) {
            throw new Error(`Server returned invalid JSON. Response: ${rawText.substring(0, 100)}...`);
        }

        if (!response.ok) {
            throw new Error(result?.detail || 'Operation failed');
        }

        return result;
    }

    private handleError(error: unknown, webviewView: vscode.WebviewView) {
        console.error('Operation error:', error);
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        webviewView.webview.postMessage({
            type: 'error',
            message: errorMessage
        });
    }

    private getHtmlContent(webview: vscode.Webview): string {
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
                <title>Authentication</title>
            </head>
            <body>
                <div class="container ${this.currentView}">
                    <!-- Login Form -->
                    <form id="loginForm" class="auth-form ${this.currentView === 'login' ? 'active' : ''}">
                        <h2>Login</h2>
                        <div class="form-group">
                            <input type="text" id="loginUsername" placeholder="Username" required>
                        </div>
                        <div class="form-group">
                            <input type="password" id="loginPassword" placeholder="Password" required>
                        </div>
                        <button type="submit">Login</button>
                        <div class="switch-view">
                            Don't have an account? <a href="#" id="showRegister">Register</a>
                        </div>
                    </form>

                    <!-- Register Form -->
                    <form id="registerForm" class="auth-form ${this.currentView === 'register' ? 'active' : ''}">
                        <h2>Register</h2>
                        <div class="info-text">
                            This will create your Codex cloud account for backup and sync.
                        </div>
                        <div class="form-group">
                            <input type="text" id="registerUsername" placeholder="Username" required>
                        </div>
                        <div class="form-group">
                            <input type="email" id="registerEmail" placeholder="Email" required>
                        </div>
                        <div class="form-group">
                            <input type="password" id="registerPassword" placeholder="Password" required>
                            <div class="password-requirements">
                                Password must contain at least 8 characters, including uppercase, lowercase, and numbers
                            </div>
                        </div>
                        <button type="submit">Register</button>
                        <div class="switch-view">
                            Already have an account? <a href="#" id="showLogin">Login</a>
                        </div>
                    </form>

                    <div id="error" class="error"></div>
                </div>

                <script nonce="${nonce}">
                    const vscode = acquireVsCodeApi();
                    const loginForm = document.getElementById('loginForm');
                    const registerForm = document.getElementById('registerForm');
                    const errorDiv = document.getElementById('error');
                    const showRegister = document.getElementById('showRegister');
                    const showLogin = document.getElementById('showLogin');

                    loginForm.addEventListener('submit', (e) => {
                        e.preventDefault();
                        const username = document.getElementById('loginUsername').value;
                        const password = document.getElementById('loginPassword').value;

                        vscode.postMessage({
                            type: 'login',
                            username,
                            password
                        });
                    });

                    registerForm.addEventListener('submit', (e) => {
                        e.preventDefault();
                        const username = document.getElementById('registerUsername').value;
                        const email = document.getElementById('registerEmail').value;
                        const password = document.getElementById('registerPassword').value;

                        vscode.postMessage({
                            type: 'register',
                            username,
                            email,
                            password
                        });
                    });

                    showRegister.addEventListener('click', (e) => {
                        e.preventDefault();
                        vscode.postMessage({ type: 'viewChange', view: 'register' });
                    });

                    showLogin.addEventListener('click', (e) => {
                        e.preventDefault();
                        vscode.postMessage({ type: 'viewChange', view: 'login' });
                    });

                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.type === 'error') {
                            errorDiv.textContent = message.message;
                        }
                    });
                </script>

                <style>
                    body {
                        padding: 15px;
                        font-family: var(--vscode-font-family);
                    }
                    .container {
                        position: relative;
                    }
                    .auth-form {
                        display: none;
                    }
                    .auth-form.active {
                        display: block;
                    }
                    h2 {
                        margin-bottom: 15px;
                        color: var(--vscode-foreground);
                    }
                    .info-text {
                        font-size: 12px;
                        color: var(--vscode-descriptionForeground);
                        margin-bottom: 15px;
                    }
                    .form-group {
                        margin-bottom: 15px;
                    }
                    input {
                        width: 100%;
                        padding: 8px;
                        border: 1px solid var(--vscode-input-border);
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                    }
                    .password-requirements {
                        font-size: 11px;
                        color: var(--vscode-descriptionForeground);
                        margin-top: 5px;
                    }
                    button {
                        width: 100%;
                        padding: 8px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        cursor: pointer;
                    }
                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    .error {
                        color: var(--vscode-errorForeground);
                        margin-top: 10px;
                    }
                    .switch-view {
                        margin-top: 15px;
                        text-align: center;
                        font-size: 12px;
                    }
                    .switch-view a {
                        color: var(--vscode-textLink-foreground);
                        text-decoration: none;
                    }
                    .switch-view a:hover {
                        color: var(--vscode-textLink-activeForeground);
                        text-decoration: underline;
                    }
                </style>
            </body>
            </html>`;
    }

    public dispose() {
        if (this._view) {
            this._view = undefined;
        }
    }
} 