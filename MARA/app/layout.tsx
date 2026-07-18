import type {Metadata} from 'next';
import { Instrument_Serif, Inter, Spline_Sans_Mono } from 'next/font/google';
import './globals.css';
import { BackgroundFX } from '@/components/BackgroundFX';
import { CustomCursor } from '@/components/CustomCursor';
import { EnvironmentProvider } from '@/components/context/EnvironmentContext';
import { Onboarding } from '@/components/Onboarding';

const instrument = Instrument_Serif({
  weight: '400',
  style: 'italic',
  subsets: ['latin'],
  variable: '--font-instrument',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
});

const spline = Spline_Sans_Mono({
  subsets: ['latin'],
  variable: '--font-spline',
});

export const metadata: Metadata = {
  title: 'MARA - Autonomous Macro Intelligence',
  description: 'Futuristic AI-native financial operating system',
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="en" className={`${instrument.variable} ${inter.variable} ${spline.variable}`}>
      <body className="font-sans bg-background text-foreground antialiased" suppressHydrationWarning>
        <EnvironmentProvider>
          <BackgroundFX />
          <CustomCursor />
          <Onboarding />
          {children}
        </EnvironmentProvider>
      </body>
    </html>
  );
}
