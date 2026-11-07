import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'MediQueue Patient Portal',
    short_name: 'MediQueue',
    description: 'Book OPD tokens and receive live consultation alerts.',
    start_url: '/book',
    display: 'standalone',
    background_color: '#f8fafc',
    theme_color: '#020617',
    icons: [
      {
        src: '/favicon.ico',
        sizes: 'any',
        type: 'image/x-icon',
      },
    ],
  };
}
