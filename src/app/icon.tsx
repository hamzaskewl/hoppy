import { ImageResponse } from 'next/og'
 
export const runtime = 'edge'
export const size = {
  width: 64,
  height: 64,
}
export const contentType = 'image/png'
 
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #87DD8D 0%, #22c55e 100%)',
        }}
      >
        <div
          style={{
            fontSize: 40,
            fontWeight: 'bold',
            color: 'white',
            display: 'flex',
          }}
        >
          🐰
        </div>
      </div>
    ),
    {
      ...size,
    }
  )
}
