import { VersionGraph } from '@start9labs/start-sdk'
import { current } from './current'
import { v3_31_0_3 } from './v3.31.0.3'
import { v3_31_0_2 } from './v3.31.0.2'
import { v3_31_0_0 } from './v3.31.0.0'
import { v3_31_0_1 } from './v3.31.0.1'

export const versionGraph = VersionGraph.of({
  current,
  other: [v3_31_0_3, v3_31_0_2, v3_31_0_1, v3_31_0_0],
})
