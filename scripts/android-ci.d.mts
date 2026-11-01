export type AndroidCiEnvironment = Readonly<Record<string, string | undefined>>;
export declare const ANDROID_BUILD_MODES: readonly ['debug', 'release', 'bundle'];
export declare function validateAndroidBuildEnv(env: AndroidCiEnvironment, mode: string): string[];
export declare function verifyAndroidAssets(directory: string, env: AndroidCiEnvironment): void;
