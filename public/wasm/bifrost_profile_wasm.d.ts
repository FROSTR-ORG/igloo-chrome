/* tslint:disable */
/* eslint-disable */

export function bf_package_version(): number;

export function bfonboard_prefix(): string;

export function bfprofile_prefix(): string;

export function bfshare_prefix(): string;

export function build_profile_backup_event(share_secret: string, backup_json: string, created_at_seconds?: number | null): string;

export function create_encrypted_profile_backup(profile_json: string): string;

export function create_profile_package_pair(payload_json: string, password: string): string;

export function decode_bfonboard_package(package_text: string, password: string): string;

export function decode_bfprofile_package(package_text: string, password: string): string;

export function decode_bfshare_package(package_text: string, password: string): string;

export function decrypt_profile_backup_content(ciphertext: string, share_secret: string): string;

export function derive_profile_backup_conversation_key_hex(share_secret: string): string;

export function derive_profile_id_from_share_pubkey(share_pubkey: string): string;

export function derive_profile_id_from_share_secret(share_secret: string): string;

export function encode_bfonboard_package(payload_json: string, password: string): string;

export function encode_bfprofile_package(payload_json: string, password: string): string;

export function encode_bfshare_package(payload_json: string, password: string): string;

export function encrypt_profile_backup_content(backup_json: string, share_secret: string): string;

export function parse_profile_backup_event(event_json: string, share_secret: string): string;

export function preview_bfprofile_package(package_text: string, password: string, label_override?: string | null): string;

export function preview_bfshare_recovery_json(package_text: string, password: string): string;

export function profile_backup_event_kind(): number;

export function profile_backup_key_domain(): string;

export function recover_profile_from_share_and_backup(share_json: string, backup_json: string): string;

export function validate_relay_profile_json(profile_json: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly bf_package_version: () => number;
    readonly bfonboard_prefix: () => [number, number];
    readonly bfprofile_prefix: () => [number, number];
    readonly bfshare_prefix: () => [number, number];
    readonly build_profile_backup_event: (a: number, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly create_encrypted_profile_backup: (a: number, b: number) => [number, number, number, number];
    readonly create_profile_package_pair: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly decode_bfonboard_package: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly decode_bfprofile_package: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly decode_bfshare_package: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly decrypt_profile_backup_content: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly derive_profile_backup_conversation_key_hex: (a: number, b: number) => [number, number, number, number];
    readonly derive_profile_id_from_share_pubkey: (a: number, b: number) => [number, number, number, number];
    readonly derive_profile_id_from_share_secret: (a: number, b: number) => [number, number, number, number];
    readonly encode_bfonboard_package: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly encode_bfprofile_package: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly encode_bfshare_package: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly encrypt_profile_backup_content: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly parse_profile_backup_event: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly preview_bfprofile_package: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly preview_bfshare_recovery_json: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly profile_backup_event_kind: () => number;
    readonly profile_backup_key_domain: () => [number, number];
    readonly recover_profile_from_share_and_backup: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly validate_relay_profile_json: (a: number, b: number) => [number, number, number, number];
    readonly rustsecp256k1_v0_10_0_context_create: (a: number) => number;
    readonly rustsecp256k1_v0_10_0_context_destroy: (a: number) => void;
    readonly rustsecp256k1_v0_10_0_default_error_callback_fn: (a: number, b: number) => void;
    readonly rustsecp256k1_v0_10_0_default_illegal_callback_fn: (a: number, b: number) => void;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
