'use client';

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface ComparisonChartProps {
  data: Array<{
    label: string;
    current: number;
    previous: number;
    projected?: boolean;
  }>;
  title?: string;
}

export function ComparisonChart({ data, title = 'Week-over-Week' }: ComparisonChartProps) {
  const hasProjected = data.some((row) => row.projected);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={200}>
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 10 }} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px', fontSize: '12px' }} />
              <Legend wrapperStyle={{ fontSize: '11px' }} />
              <Bar dataKey="previous" name="Previous" fill="var(--muted-foreground)" radius={[2, 2, 0, 0]} />
              <Bar dataKey="current" name="Current" fill="var(--primary)" radius={[2, 2, 0, 0]} />
            </BarChart>
            </ResponsiveContainer>
            {hasProjected ? (
              <p className="mt-2 text-center text-xs text-muted-foreground">
                Baseline view: previous period bars fill automatically as you add more days.
              </p>
            ) : null}
          </>
        ) : (
          <p className="py-8 text-center text-sm text-muted-foreground">Not enough data for comparison</p>
        )}
      </CardContent>
    </Card>
  );
}
