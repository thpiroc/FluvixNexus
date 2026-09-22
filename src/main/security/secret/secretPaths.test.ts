import { describe, expect, it } from 'vitest'
import { classifySecretPath } from './secretPaths'

/**
 * 名前だけで Secret ファイルを決める規則（Security Core v1 の STEP3）。
 *
 * ここで見ているのは**名前だけ**。`.env.example` が雛形として読めることと、
 * その中身の値が伏せられることは別の話で、後者は secretMasking.test.ts が持つ。
 */

describe('.env 系', () => {
  it('本物の .env は Secret ファイル', () => {
    for (const name of [
      '.env',
      '.env.local',
      '.env.production',
      '.env.development',
      '.env.production.local',
      '.env.test',
      'production.env'
    ]) {
      expect(classifySecretPath(name)).toBe('secret-file')
    }
  })

  it('雛形は読める', () => {
    for (const name of [
      '.env.example',
      '.env.sample',
      '.env.template',
      '.env.local.example',
      'example.env',
      'sample.env',
      'template.env'
    ]) {
      expect(classifySecretPath(name)).toBe('template-file')
    }
  })

  it('雛形の印が最後に無いものは、雛形として扱わない', () => {
    // `.env.example.local` は「雛形を写して本物にしたもの」でありうる。
    expect(classifySecretPath('.env.example.local')).toBe('secret-file')
  })

  it('大文字小文字は区別しない', () => {
    expect(classifySecretPath('.ENV')).toBe('secret-file')
    expect(classifySecretPath('.Env.Production')).toBe('secret-file')
    expect(classifySecretPath('.ENV.EXAMPLE')).toBe('template-file')
  })

  it('入れ子でも同じ', () => {
    expect(classifySecretPath('packages/api/.env.production')).toBe('secret-file')
    expect(classifySecretPath('packages/api/.env.example')).toBe('template-file')
  })

  it('区切りは / でも \\ でもよい', () => {
    expect(classifySecretPath('packages\\api\\.env')).toBe('secret-file')
  })
})

describe('資格情報', () => {
  it('credential / secret を語として持ち、資格情報の形式なら Secret ファイル', () => {
    for (const name of [
      'credentials',
      'credentials.json',
      'aws-credentials',
      '.git-credentials',
      'client_secret.json',
      'secrets.yaml',
      'config/secrets.yml',
      'secrets.toml',
      'secrets.ini',
      'app-secrets.txt',
      '.aws/credentials'
    ]) {
      expect(classifySecretPath(name)).toBe('secret-file')
    }
  })

  it('語の一部に含まれるだけなら当たらない', () => {
    for (const name of [
      'src/mcp/secretsManager.ts',
      'src/credentialsProvider.ts',
      'docs/secrecy.md'
    ]) {
      expect(classifySecretPath(name)).toBe('ordinary-file')
    }
  })

  it('雛形の印が付いていれば読める', () => {
    expect(classifySecretPath('credentials.example.json')).toBe('template-file')
  })
})

/**
 * 普通のソースコードを、名前だけで Secret ファイルにしない（2026-09-23 決定）。
 *
 * ソースコードを名前で拒んでも中身の Secret は1つも減らない。中身に本物の値が
 * あれば Content Detection が値だけを Mask する（secretDetection.test.ts）。
 */
describe('ソースコードは名前だけで拒まない', () => {
  it('credential / secret / private key を名前に持つソースコードも読める', () => {
    for (const name of [
      'src/security/secret.ts',
      'src/auth/credentials.ts',
      'token.ts',
      'secrets.test.ts',
      'src/crypto/privateKey.ts',
      'lib/credentials.js',
      'app/secretStore.tsx',
      'internal/secrets.go',
      'app/credentials.py',
      'Secrets.cs',
      'src/secret.rs',
      'scripts/rotate-secrets.sh',
      'src/api/credentials.module.ts',
      'docs/secrets.md'
    ]) {
      expect(classifySecretPath(name)).toBe('ordinary-file')
    }
  })

  it('同じ語でも、資格情報の形式なら Secret ファイルのまま', () => {
    // false negative の回帰。形式を緩めても、本物の置き場は拒み続ける。
    expect(classifySecretPath('src/auth/credentials.json')).toBe('secret-file')
    expect(classifySecretPath('src/security/secret.yaml')).toBe('secret-file')
    expect(classifySecretPath('src/crypto/private_key.txt')).toBe('secret-file')
    expect(classifySecretPath('src/crypto/privateKey.pem')).toBe('secret-file')
  })

  it('.npmrc は Secret ファイルにしない（中身の token を Mask する）', () => {
    expect(classifySecretPath('.npmrc')).toBe('ordinary-file')
    expect(classifySecretPath('packages/api/.npmrc')).toBe('ordinary-file')
  })
})

describe('鍵', () => {
  it('SSH の秘密鍵は Secret ファイル', () => {
    for (const name of ['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'id_ed25519_sk']) {
      expect(classifySecretPath(name)).toBe('secret-file')
    }
  })

  it('公開鍵は Secret ファイルではない', () => {
    expect(classifySecretPath('id_rsa.pub')).toBe('ordinary-file')
    expect(classifySecretPath('id_ed25519.pub')).toBe('ordinary-file')
  })

  it('鍵の入れ物にあたる拡張子は Secret ファイル', () => {
    for (const name of [
      'server.pem',
      'private.key',
      'cert.p12',
      'cert.pfx',
      'store.jks',
      'app.keystore',
      'server.ppk',
      'deploy/PRODUCTION.PEM'
    ]) {
      expect(classifySecretPath(name)).toBe('secret-file')
    }
  })

  it('private key を名前に持ち、資格情報の形式なら Secret ファイル', () => {
    for (const name of ['private_key.txt', 'private-key', 'privatekey', 'private_key.json']) {
      expect(classifySecretPath(name)).toBe('secret-file')
    }
  })

  it('鍵には雛形の印が効かない', () => {
    // 鍵の雛形というものはまず無く、中身が本物である方がありそうなため。
    expect(classifySecretPath('example.pem')).toBe('secret-file')
    expect(classifySecretPath('id_rsa.sample')).toBe('secret-file')
  })

  it('鍵置き場のフォルダの中は、名前によらず Secret ファイル', () => {
    expect(classifySecretPath('.ssh/config')).toBe('secret-file')
    expect(classifySecretPath('home/.SSH/known_hosts')).toBe('secret-file')
    expect(classifySecretPath('.gnupg/pubring.kbx')).toBe('secret-file')
  })

  it('そのままの名前で資格情報にあたるもの', () => {
    for (const name of ['.netrc', '_netrc', '.pgpass', '.htpasswd', '.pypirc']) {
      expect(classifySecretPath(name)).toBe('secret-file')
    }
  })
})

describe('普通のファイル', () => {
  it('Secret の名前でなければ普通のファイル', () => {
    for (const name of [
      'src/main/index.ts',
      'README.md',
      'package.json',
      'src/env/browser.ts',
      'environment.ts',
      'docs/security.md'
    ]) {
      expect(classifySecretPath(name)).toBe('ordinary-file')
    }
  })
})

describe('判定できないものは Secret 側', () => {
  it('文字列でない・空・NUL を含むものは Secret ファイル', () => {
    for (const value of [undefined, null, 0, true, {}, [], '', '   ', 'a\0b', '/', '\\']) {
      expect(classifySecretPath(value)).toBe('secret-file')
    }
  })
})
