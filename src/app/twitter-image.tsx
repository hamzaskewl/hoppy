import { ImageResponse } from 'next/og'
import { readFile } from 'fs/promises'
import { join } from 'path'

export const runtime = 'nodejs'
export const alt = 'hoppy - Privacy-First Payments'
export const size = {
  width: 1200,
  height: 630,
}
export const contentType = 'image/png'

export default async function Image() {
  // Read the logo file
  const logoPath = join(process.cwd(), 'public', 'hoppy-logo.png')
  const logoData = await readFile(logoPath)
  const logoBase64 = `data:image/png;base64,${logoData.toString('base64')}`

  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #16213e 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        {/* Circular logo container */}
        <div
          style={{
            width: 200,
            height: 200,
            borderRadius: '50%',
            overflow: 'hidden',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(135deg, #87DD8D 0%, #22c55e 100%)',
            boxShadow: '0 20px 60px rgba(135, 221, 141, 0.3)',
            marginBottom: 40,
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logoBase64}
            alt="hoppy logo"
            width={180}
            height={180}
            style={{
              objectFit: 'contain',
            }}
          />
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 72,
            fontWeight: 'bold',
            color: '#87DD8D',
            marginBottom: 16,
            letterSpacing: '-2px',
          }}
        >
          hoppy
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 32,
            color: '#ffffff',
            opacity: 0.9,
            marginBottom: 8,
          }}
        >
          Load. Redeem. Privately.
        </div>

        {/* Subtitle */}
        <div
          style={{
            fontSize: 24,
            color: '#87DD8D',
            opacity: 0.7,
          }}
        >
          Privacy-First Payments on Solana
        </div>
      </div>
    ),
    {
      ...size,
    }
  )
}
