ARG JAVA_IMAGE=apache/rocketmq:5.2.0
FROM ${JAVA_IMAGE}
USER root
WORKDIR /home/nacos
RUN mkdir -p conf target data logs plugins
COPY nacos-server.jar /home/nacos/target/nacos-server.jar
COPY application.properties /home/nacos/conf/application.properties
EXPOSE 8848 9848
# Older cached Java 8 has a cgroup-v2 metrics bug on this Docker engine.
# Heap limits are explicit; disable JVM container auto-detection for local fallback.
ENTRYPOINT ["java", "-XX:-UseContainerSupport", "-Xms256m", "-Xmx512m", "-Dnacos.standalone=true", "-Dnacos.home=/home/nacos", "-Dloader.path=/home/nacos/plugins", "-jar", "/home/nacos/target/nacos-server.jar", "--spring.config.additional-location=file:/home/nacos/conf/application.properties"]
