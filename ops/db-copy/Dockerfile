# Build context is ops/db-copy (render.yaml dockerContext). The copy runs as
# CMD so Render's dockerCommand parsing never touches the script.
FROM docker.io/library/postgres:17-alpine
COPY copy.sh /copy.sh
CMD ["sh", "/copy.sh"]
