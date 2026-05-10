declare module 'smtp-client' {
  export interface SMTPClientOptions {
    host: string;
    port: number;
    secure?: boolean;
    timeout?: number;
    /** Prefer IPv4 (4) to avoid ENETUNREACH on broken IPv6 paths (common on PaaS). */
    family?: number;
  }

  export interface TimeoutOptions {
    timeout?: number;
  }

  export interface GreetOptions extends TimeoutOptions {
    hostname?: string;
  }

  export interface AuthPlainOptions extends TimeoutOptions {
    username: string;
    password: string;
  }

  export interface MailOptions extends TimeoutOptions {
    from: string;
  }

  export interface RcptOptions extends TimeoutOptions {
    to: string;
  }

  export interface DataOptions extends TimeoutOptions {
    sourceSize?: number;
  }

  export class SMTPClient {
    constructor(options: SMTPClientOptions);
    connect(options?: TimeoutOptions): Promise<void>;
    greet(options?: GreetOptions): Promise<void>;
    /** STARTTLS — call after greet on port 587; then greet again before auth. */
    secure(options?: TimeoutOptions): Promise<void>;
    authPlain(options: AuthPlainOptions): Promise<void>;
    mail(options: MailOptions): Promise<void>;
    rcpt(options: RcptOptions): Promise<void>;
    data(message: string, options?: DataOptions): Promise<void>;
    quit(options?: TimeoutOptions): Promise<void>;
    close(options?: TimeoutOptions): Promise<void>;
  }
}
