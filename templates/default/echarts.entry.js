// Entry point del bundle custom de ECharts que consume el reporte HTML
// (ver `vite.echarts.config.ts`, que lo compila a
// `assets/echarts.custom.min.js`). Importa SOLO los módulos que los 4
// charts del dashboard/detalle necesitan (gauge, doughnut, barra apilada,
// sunburst) — nunca `echarts` completo (~1MB minificado) ni un import
// suelto de `echarts` a secas, que arrastra los ~30 charts/componentes del
// paquete completo aunque el reporte solo use 4.
//
// Se expone como `window.echarts` (formato IIFE, ver vite.echarts.config.ts)
// porque el reporte es HTML estático sin bundler propio del lado del
// cliente — los scripts inline de los templates (`report-charts-script.hbs`,
// `feature-detail-charts-script.hbs`) lo consumen como global, igual que
// cualquier `<script src="...">` clásico.
import * as echarts from 'echarts/core';
import { BarChart, GaugeChart, PieChart, SunburstChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';

echarts.use([
  GaugeChart,
  PieChart,
  BarChart,
  SunburstChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

window.echarts = echarts;
