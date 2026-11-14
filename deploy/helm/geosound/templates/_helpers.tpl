{{/* Labels shared by every object of the release. */}}
{{- define "geosound.labels" -}}
app.kubernetes.io/part-of: geosound
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end }}

{{/* Selector of one app: stable, never changed after the first install. */}}
{{- define "geosound.selector" -}}
app.kubernetes.io/name: {{ .name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
{{- end }}

{{/* Full image reference of one app; fails without global.image.tag. */}}
{{- define "geosound.image" -}}
{{- $img := .root.Values.global.image -}}
{{- $tag := required "global.image.tag is required: set the image tag CI published (sha-<7> or vX.Y.Z) in deploy/envs/<env>/values.yaml" $img.tag -}}
{{- printf "%s/geosound-%s:%s" $img.registry .name $tag -}}
{{- end }}

{{/* One app's settings merged over .Values.defaults (the app wins, nested maps merged). */}}
{{- define "geosound.app" -}}
{{- /* A key left empty in a values file (`probes:`) is null: skip it, keep the default. */ -}}
{{- $app := dict -}}
{{- range $k, $v := (.app | default dict) -}}
{{- if not (kindIs "invalid" $v) }}{{ $_ := set $app $k (deepCopy $v) }}{{ end -}}
{{- end -}}
{{- $merged := mergeOverwrite (deepCopy .root.Values.defaults) $app -}}
{{- toYaml $merged -}}
{{- end }}
