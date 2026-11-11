'use client';

import { useParams } from 'next/navigation';
import { Builder } from './Builder';

export default function DeckPage() {
  const { id } = useParams<{ id: string }>();
  return <Builder key={id} id={id} />;
}
