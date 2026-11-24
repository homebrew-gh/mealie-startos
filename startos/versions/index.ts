import { VersionGraph } from '@start9labs/start-sdk'
import { current } from './current'
import { v3_31_0_14 } from './v3.31.0.14'
import { v3_31_0_13 } from './v3.31.0.13'
import { v3_31_0_12 } from './v3.31.0.12'
import { v3_31_0_11 } from './v3.31.0.11'
import { v3_31_0_10 } from './v3.31.0.10'
import { v3_31_0_9 } from './v3.31.0.9'
import { v3_31_0_8 } from './v3.31.0.8'
import { v3_31_0_7 } from './v3.31.0.7'
import { v3_31_0_6 } from './v3.31.0.6'
import { v3_31_0_5 } from './v3.31.0.5'
import { v3_31_0_4 } from './v3.31.0.4'
import { v3_31_0_3 } from './v3.31.0.3'
import { v3_31_0_2 } from './v3.31.0.2'
import { v3_31_0_0 } from './v3.31.0.0'
import { v3_31_0_1 } from './v3.31.0.1'

export const versionGraph = VersionGraph.of({
  current,
  other: [
    v3_31_0_14,
    v3_31_0_13,
    v3_31_0_12,
    v3_31_0_11,
    v3_31_0_10,
    v3_31_0_9,
    v3_31_0_8,
    v3_31_0_7,
    v3_31_0_6,
    v3_31_0_5,
    v3_31_0_4,
    v3_31_0_3,
    v3_31_0_2,
    v3_31_0_1,
    v3_31_0_0,
  ],
})
